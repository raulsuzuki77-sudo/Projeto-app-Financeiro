import ExpoModulesCore
import UIKit
import UniformTypeIdentifiers

/// Arquivo encontrado na pasta. `caminho` e relativo a pasta escolhida (com subpastas).
struct ArquivoDaPasta: Record {
  @Field var caminho: String = ""
  @Field var nome: String = ""
  @Field var tamanho: Double = 0
  /// Segundos desde 1970.
  @Field var modificado: Double = 0
  /// Falso quando o arquivo esta no iCloud Drive e ainda nao foi baixado para o aparelho.
  @Field var disponivel: Bool = true
}

struct EstadoDaPasta: Record {
  @Field var configurada: Bool = false
  /// Falso quando a permissao guardada deixou de valer (pasta apagada, movida ou acesso revogado).
  @Field var valida: Bool = false
  @Field var nome: String = ""
}

internal final class PastaFalhaException: GenericException<String> {
  override var reason: String { param }
}

/// Recebe a escolha do usuario no seletor de pastas do iOS.
internal final class SeletorDePastaDelegate: NSObject, UIDocumentPickerDelegate, UIAdaptivePresentationControllerDelegate {
  private let aoTerminar: (URL?) -> Void
  private var terminou = false

  init(aoTerminar: @escaping (URL?) -> Void) {
    self.aoTerminar = aoTerminar
  }

  private func terminar(_ url: URL?) {
    if terminou { return }
    terminou = true
    aoTerminar(url)
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    terminar(urls.first)
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    terminar(nil)
  }

  func presentationControllerDidDismiss(_ presentationController: UIPresentationController) {
    terminar(nil)
  }
}

public class PastaNativaModule: Module {
  private static let chaveBookmark = "PastaDocumentosFinanceirosBookmark"
  private static let maxArquivos = 1000

  private var delegadoDoSeletor: SeletorDePastaDelegate?
  private var seletorAberto = false

  public func definition() -> ModuleDefinition {
    Name("PastaNativa")

    /// Abre o seletor de pastas do iOS e guarda a permissao de forma persistente. Devolve o nome da pasta, ou lanca PASTA_CANCELADA.
    AsyncFunction("escolherPasta") { (promise: Promise) in
      if self.seletorAberto {
        promise.reject(PastaFalhaException("O seletor de pastas ja esta aberto."))
        return
      }
      guard let controlador = self.appContext?.utilities?.currentViewController() else {
        promise.reject(PastaFalhaException("Nao foi possivel abrir o seletor de pastas."))
        return
      }
      let seletor = UIDocumentPickerViewController(forOpeningContentTypes: [UTType.folder], asCopy: false)
      seletor.allowsMultipleSelection = false
      let delegado = SeletorDePastaDelegate { [weak self] url in
        self?.seletorAberto = false
        self?.delegadoDoSeletor = nil
        guard let url = url else {
          promise.reject(PastaFalhaException("PASTA_CANCELADA"))
          return
        }
        let acessou = url.startAccessingSecurityScopedResource()
        defer { if acessou { url.stopAccessingSecurityScopedResource() } }
        do {
          let dados = try url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil)
          UserDefaults.standard.set(dados, forKey: PastaNativaModule.chaveBookmark)
          promise.resolve(url.lastPathComponent)
        } catch {
          promise.reject(PastaFalhaException("Nao foi possivel guardar a permissao da pasta: \(error.localizedDescription)"))
        }
      }
      self.delegadoDoSeletor = delegado
      self.seletorAberto = true
      seletor.delegate = delegado
      seletor.presentationController?.delegate = delegado
      controlador.present(seletor, animated: true)
    }.runOnQueue(.main)

    /// Diz se ha pasta configurada e se a permissao guardada ainda vale.
    Function("estadoDaPasta") { () -> EstadoDaPasta in
      var estado = EstadoDaPasta()
      guard UserDefaults.standard.data(forKey: PastaNativaModule.chaveBookmark) != nil else {
        return estado
      }
      estado.configurada = true
      if let raiz = PastaNativaModule.resolverPasta() {
        estado.valida = true
        estado.nome = raiz.lastPathComponent
      }
      return estado
    }

    /// Esquece a pasta escolhida (nao apaga nada nela).
    Function("esquecerPasta") { () in
      UserDefaults.standard.removeObject(forKey: PastaNativaModule.chaveBookmark)
    }

    /// Lista os arquivos da pasta, com as subpastas.
    AsyncFunction("listarArquivos") { () throws -> [ArquivoDaPasta] in
      return try PastaNativaModule.comAcesso { (raiz: URL) throws -> [ArquivoDaPasta] in
        return try PastaNativaModule.listar(raiz)
      }
    }

    /// Copia um arquivo da pasta para a area temporaria do aplicativo e devolve o endereco (file://) da copia.
    AsyncFunction("copiarParaCache") { (caminho: String) throws -> String in
      return try PastaNativaModule.comAcesso { (raiz: URL) throws -> String in
        let origem = try PastaNativaModule.dentroDaRaiz(raiz, caminho)
        let pasta = FileManager.default.temporaryDirectory.appendingPathComponent("pasta-docs-" + UUID().uuidString, isDirectory: true)
        try FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        let destino = pasta.appendingPathComponent(origem.lastPathComponent)
        var erroDeCoordenacao: NSError?
        var erroDeCopia: Error?
        // A leitura coordenada espera o iCloud Drive entregar o arquivo, se for o caso.
        NSFileCoordinator().coordinate(readingItemAt: origem, options: [], error: &erroDeCoordenacao) { lido in
          do {
            try FileManager.default.copyItem(at: lido, to: destino)
          } catch {
            erroDeCopia = error
          }
        }
        var falha: Error? = erroDeCoordenacao
        if falha == nil { falha = erroDeCopia }
        if let e = falha {
          throw PastaFalhaException("Nao foi possivel ler \(origem.lastPathComponent): \(e.localizedDescription)")
        }
        return destino.absoluteString
      }
    }

    /// Apaga a copia temporaria feita por `copiarParaCache`.
    Function("liberarCopia") { (uri: String) in
      guard let url = URL(string: uri), url.isFileURL else { return }
      let pasta = url.deletingLastPathComponent()
      if pasta.lastPathComponent.hasPrefix("pasta-docs-") {
        try? FileManager.default.removeItem(at: pasta)
      }
    }

    /// Grava (ou substitui) um arquivo dentro de uma subpasta da pasta escolhida, criando a subpasta se preciso.
    AsyncFunction("gravarNaPasta") { (subpasta: String, nome: String, origemUri: String) throws -> String in
      guard let origem = URL(string: origemUri), origem.isFileURL else {
        throw PastaFalhaException("O arquivo de origem precisa ser local.")
      }
      guard PastaNativaModule.nomeSimples(nome), subpasta.isEmpty || PastaNativaModule.nomeSimples(subpasta) else {
        throw PastaFalhaException("Nome de arquivo ou pasta invalido.")
      }
      return try PastaNativaModule.comAcesso { (raiz: URL) throws -> String in
        let pasta = subpasta.isEmpty ? raiz : raiz.appendingPathComponent(subpasta, isDirectory: true)
        try FileManager.default.createDirectory(at: pasta, withIntermediateDirectories: true)
        let destino = pasta.appendingPathComponent(nome)
        var erroDeCoordenacao: NSError?
        var erroDeEscrita: Error?
        NSFileCoordinator().coordinate(writingItemAt: destino, options: .forReplacing, error: &erroDeCoordenacao) { alvo in
          do {
            if FileManager.default.fileExists(atPath: alvo.path) {
              try FileManager.default.removeItem(at: alvo)
            }
            try FileManager.default.copyItem(at: origem, to: alvo)
          } catch {
            erroDeEscrita = error
          }
        }
        var falha: Error? = erroDeCoordenacao
        if falha == nil { falha = erroDeEscrita }
        if let e = falha {
          throw PastaFalhaException("Nao foi possivel gravar \(nome): \(e.localizedDescription)")
        }
        return subpasta.isEmpty ? nome : subpasta + "/" + nome
      }
    }
  }

  // MARK: - Apoio

  /// Resolve a permissao guardada. Renova o bookmark quando o sistema o considera desatualizado.
  private static func resolverPasta() -> URL? {
    guard let dados = UserDefaults.standard.data(forKey: chaveBookmark) else { return nil }
    var obsoleto = false
    guard let url = try? URL(resolvingBookmarkData: dados, options: [], relativeTo: nil, bookmarkDataIsStale: &obsoleto) else {
      return nil
    }
    if obsoleto {
      let acessou = url.startAccessingSecurityScopedResource()
      defer { if acessou { url.stopAccessingSecurityScopedResource() } }
      if let novos = try? url.bookmarkData(options: [], includingResourceValuesForKeys: nil, relativeTo: nil) {
        UserDefaults.standard.set(novos, forKey: chaveBookmark)
      }
    }
    return url
  }

  /// Executa `corpo` com acesso a pasta (escopo de seguranca aberto e fechado em volta).
  private static func comAcesso<T>(_ corpo: (URL) throws -> T) throws -> T {
    guard let raiz = resolverPasta() else {
      throw PastaFalhaException("PASTA_NAO_CONFIGURADA")
    }
    let acessou = raiz.startAccessingSecurityScopedResource()
    defer { if acessou { raiz.stopAccessingSecurityScopedResource() } }
    return try corpo(raiz)
  }

  private static func nomeSimples(_ nome: String) -> Bool {
    return !nome.isEmpty && !nome.contains("/") && !nome.contains("\\") && nome != "." && nome != ".."
  }

  /// Monta o endereco de um caminho relativo, recusando qualquer coisa que saia da pasta escolhida.
  private static func dentroDaRaiz(_ raiz: URL, _ caminho: String) throws -> URL {
    let partes = caminho.split(separator: "/", omittingEmptySubsequences: true).map(String.init)
    if partes.isEmpty || partes.contains("..") {
      throw PastaFalhaException("Caminho invalido.")
    }
    var url = raiz
    for p in partes { url = url.appendingPathComponent(p) }
    return url
  }

  private static func listar(_ raiz: URL) throws -> [ArquivoDaPasta] {
    let chaves: [URLResourceKey] = [.isRegularFileKey, .fileSizeKey, .contentModificationDateKey]
    // Arquivos ocultos entram na enumeracao: no iCloud Drive, o que ainda nao foi baixado aparece como ".nome.icloud".
    guard let enumerador = FileManager.default.enumerator(at: raiz, includingPropertiesForKeys: chaves, options: [.skipsPackageDescendants]) else {
      throw PastaFalhaException("Nao foi possivel listar a pasta.")
    }
    let base = raiz.standardizedFileURL.path
    var saida: [ArquivoDaPasta] = []
    for caso in enumerador {
      guard let url = caso as? URL else { continue }
      let valores = try? url.resourceValues(forKeys: Set(chaves))
      if valores?.isRegularFile != true { continue }
      var nome = url.lastPathComponent
      var disponivel = true
      if nome.hasPrefix(".") && nome.hasSuffix(".icloud") {
        // marcador de arquivo do iCloud ainda nao baixado: o nome real esta dentro dele
        nome = String(nome.dropFirst().dropLast(".icloud".count))
        disponivel = false
        try? FileManager.default.startDownloadingUbiquitousItem(at: url)
      } else if nome.hasPrefix(".") {
        continue
      }
      var caminho = url.standardizedFileURL.deletingLastPathComponent().path
      if caminho.hasPrefix(base) { caminho = String(caminho.dropFirst(base.count)) }
      let relativo = (caminho.isEmpty ? "" : String(caminho.drop(while: { $0 == "/" })) + "/") + nome
      var item = ArquivoDaPasta()
      item.caminho = relativo
      item.nome = nome
      item.tamanho = Double(valores?.fileSize ?? 0)
      item.modificado = valores?.contentModificationDate?.timeIntervalSince1970 ?? 0
      item.disponivel = disponivel
      saida.append(item)
      if saida.count >= maxArquivos { break }
    }
    return saida
  }
}

import ExpoModulesCore
import PDFKit
import UIKit
import Vision

/// Uma observacao de texto. Coordenadas normalizadas (0 a 1), origem no canto INFERIOR esquerdo (convencao do Vision).
/// Em paginas de PDF com texto digital, `nativo` e verdadeiro: o texto ja vem em linhas, sem coordenadas.
struct ObservacaoOcr: Record {
  @Field var texto: String = ""
  @Field var confianca: Double = 0
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var largura: Double = 0
  @Field var altura: Double = 0
  @Field var pagina: Int = 1
  @Field var nativo: Bool = false
}

/// Trecho de texto posicionado de uma pagina de PDF, no mesmo formato do pdf.js: pontos, origem no canto INFERIOR esquerdo.
/// `tamanho` e o tamanho da fonte em pontos (do texto atribuido da pagina; sem ele, a altura da caixa do caractere dividida por 1,2).
struct ItemPdfNativo: Record {
  @Field var str: String = ""
  @Field var x: Double = 0
  @Field var y: Double = 0
  @Field var largura: Double = 0
  @Field var tamanho: Double = 0
  @Field var pagina: Int = 1
}

/// Trecho em construcao durante a leitura dos caracteres de uma pagina (ver `itensDaPagina`).
fileprivate struct TrechoAberto {
  var unidades: [unichar] = []
  var espacoAntes: Bool = false
  var x0: CGFloat = 0
  var xFim: CGFloat = 0
  var yMin: CGFloat = 0
  var yMeio: CGFloat = 0
  /// Tamanho da fonte (estimado): o maior visto no trecho.
  var tamanho: CGFloat = 0
}

internal final class OcrFalhaException: GenericException<String> {
  override var reason: String { param }
}

public class OcrNativoModule: Module {
  /// Limite de paginas por documento, para nao esgotar a memoria do aparelho.
  private static let maxPaginas = 30
  /// Resolucao da rasterizacao de PDF (a mesma usada na validacao com Tesseract no servidor).
  private static let dpi: CGFloat = 300
  private static let ladoMaximo: CGFloat = 4200

  public func definition() -> ModuleDefinition {
    Name("OcrNativo")

    /// Reconhece o texto de uma imagem (JPEG, PNG, HEIC) ou PDF local. Tudo acontece no aparelho.
    AsyncFunction("reconhecer") { (uri: String, senha: String?) throws -> [ObservacaoOcr] in
      guard let url = URL(string: uri), url.isFileURL else {
        throw OcrFalhaException("O arquivo precisa ser local.")
      }
      guard FileManager.default.isReadableFile(atPath: url.path) else {
        throw OcrFalhaException("Nao foi possivel ler o arquivo.")
      }
      if url.pathExtension.lowercased() == "pdf" {
        return try OcrNativoModule.reconhecerPdf(url, senha: senha)
      }
      return try OcrNativoModule.reconhecerImagem(url)
    }

    /// Itens posicionados de um PDF com camada de texto (para reconstruir linhas e colunas no JavaScript, como na versao web).
    /// Cada pagina comeca com um item de texto vazio (marca da pagina). PDF sem camada de texto so tem as marcas; o JavaScript segue
    /// para o caminho antigo e o OCR nessas paginas.
    AsyncFunction("extrairItens") { (uri: String, senha: String?) throws -> [ItemPdfNativo] in
      guard let url = URL(string: uri), url.isFileURL else {
        throw OcrFalhaException("O arquivo precisa ser local.")
      }
      guard FileManager.default.isReadableFile(atPath: url.path) else {
        throw OcrFalhaException("Nao foi possivel ler o arquivo.")
      }
      guard url.pathExtension.lowercased() == "pdf" else {
        throw OcrFalhaException("Apenas PDF tem itens posicionados.")
      }
      return try OcrNativoModule.extrairItensPdf(url, senha: senha)
    }
  }

  // MARK: - Imagem

  private static func reconhecerImagem(_ url: URL) throws -> [ObservacaoOcr] {
    guard let imagem = UIImage(contentsOfFile: url.path), let cg = imagem.cgImage else {
      throw OcrFalhaException("Imagem ilegivel ou formato nao suportado.")
    }
    return try reconhecer(cg, orientacao: orientacao(imagem.imageOrientation), pagina: 1)
  }

  // MARK: - PDF

  /// Abre o PDF e o desbloqueia com a senha, se preciso. Compartilhado pela leitura de texto, pelo OCR e pelos itens posicionados.
  private static func abrirPdf(_ url: URL, senha: String?) throws -> PDFDocument {
    guard let doc = PDFDocument(url: url) else {
      throw OcrFalhaException("PDF ilegivel.")
    }
    if doc.isLocked {
      // Os codigos PDF_PROTEGIDO e PDF_SENHA_INCORRETA sao lidos pelo lado JavaScript para pedir a senha ao usuario.
      guard let senha = senha, !senha.isEmpty else {
        throw OcrFalhaException("PDF_PROTEGIDO")
      }
      if !doc.unlock(withPassword: senha) {
        throw OcrFalhaException("PDF_SENHA_INCORRETA")
      }
    }
    if doc.pageCount > maxPaginas {
      throw OcrFalhaException("PDF com mais de \(maxPaginas) paginas.")
    }
    return doc
  }

  private static func reconhecerPdf(_ url: URL, senha: String?) throws -> [ObservacaoOcr] {
    let doc = try abrirPdf(url, senha: senha)
    var saida: [ObservacaoOcr] = []
    for i in 0..<doc.pageCount {
      guard let pagina = doc.page(at: i) else { continue }
      // PDF com camada de texto (extratos digitais): usa o texto exato, sem OCR e sem erros de leitura.
      if let texto = pagina.string, texto.trimmingCharacters(in: .whitespacesAndNewlines).count > 80 {
        for linha in texto.components(separatedBy: .newlines) where !linha.trimmingCharacters(in: .whitespaces).isEmpty {
          var o = ObservacaoOcr()
          o.texto = linha
          o.confianca = 1.0
          o.pagina = i + 1
          o.nativo = true
          saida.append(o)
        }
        continue
      }
      // PDF de imagem (como a fatura Nomad): rasteriza a pagina e aplica OCR.
      try autoreleasepool {
        guard let cg = rasterizar(pagina) else {
          throw OcrFalhaException("Falha ao renderizar a pagina \(i + 1).")
        }
        saida.append(contentsOf: try reconhecer(cg, orientacao: .up, pagina: i + 1))
      }
    }
    return saida
  }

  private static func rasterizar(_ pagina: PDFPage) -> CGImage? {
    let caixa = pagina.bounds(for: .mediaBox)
    guard caixa.width > 0, caixa.height > 0 else { return nil }
    let escala = min(dpi / 72.0, ladoMaximo / max(caixa.width, caixa.height))
    let tamanho = CGSize(width: caixa.width * escala, height: caixa.height * escala)
    let formato = UIGraphicsImageRendererFormat()
    formato.scale = 1
    formato.opaque = true
    let imagem = UIGraphicsImageRenderer(size: tamanho, format: formato).image { ctx in
      UIColor.white.set()
      ctx.fill(CGRect(origin: .zero, size: tamanho))
      // O sistema de coordenadas do PDF e invertido em relacao ao do UIKit.
      ctx.cgContext.translateBy(x: 0, y: tamanho.height)
      ctx.cgContext.scaleBy(x: escala, y: -escala)
      pagina.draw(with: .mediaBox, to: ctx.cgContext)
    }
    return imagem.cgImage
  }

  // MARK: - Itens posicionados (PDF com camada de texto)

  /// Espacos e quebras de linha: encerram o trecho em construcao.
  private static func ehSeparador(_ u: unichar) -> Bool {
    if u == 32 || u == 0x85 || u == 0xA0 || u == 0x2028 || u == 0x2029 || u == 0x202F || u == 0x3000 {
      return true
    }
    return (u >= 9 && u <= 13) || (u >= 0x2000 && u <= 0x200A)
  }

  private static func extrairItensPdf(_ url: URL, senha: String?) throws -> [ItemPdfNativo] {
    let doc = try abrirPdf(url, senha: senha)
    var saida: [ItemPdfNativo] = []
    for i in 0..<doc.pageCount {
      guard let pagina = doc.page(at: i) else { continue }
      // Item de texto vazio: marca a existencia da pagina, para o JavaScript saber quais paginas nao tem texto (PDF misto).
      var marca = ItemPdfNativo()
      marca.pagina = i + 1
      saida.append(marca)
      saida.append(contentsOf: itensDaPagina(pagina, numero: i + 1))
    }
    return saida
  }

  private static func montarItem(_ t: TrechoAberto, pagina: Int) -> ItemPdfNativo {
    var o = ItemPdfNativo()
    // Fontes sem mapa Unicode podem deixar U+0000 no lugar de "a" (o JavaScript aplica o mesmo reparo; aqui evita-se o caractere nulo na ponte).
    let texto = String(decoding: t.unidades, as: UTF16.self).replacingOccurrences(of: "\u{0000}", with: "a")
    o.str = t.espacoAntes ? " " + texto : texto
    o.x = Double(t.x0)
    o.y = Double(t.yMin)
    o.largura = Double(max(0, t.xFim - t.x0))
    o.tamanho = Double(t.tamanho)
    o.pagina = pagina
    return o
  }

  /// Percorre os caracteres da pagina (indices UTF-16 de `PDFPage.string`) e junta os contiguos da mesma linha em trechos.
  /// Um novo trecho comeca em espaco ou quebra de linha, quando a linha-base muda e quando a folga horizontal passa de 15% do tamanho.
  /// Todo caractere visivel entra em algum trecho (sem geometria, acompanha o trecho vizinho); nada e descartado em silencio.
  private static func itensDaPagina(_ pagina: PDFPage, numero: Int) -> [ItemPdfNativo] {
    guard let texto = pagina.string else { return [] }
    let ns = texto as NSString
    let total = ns.length
    if total == 0 { return [] }

    // Texto atribuido (fontes). Os indices so valem se o comprimento bater com o de `string`.
    let atributos = pagina.attributedString
    let fontesAlinhadas = atributos != nil && atributos!.length == total

    var itens: [ItemPdfNativo] = []
    var trecho: TrechoAberto? = nil
    var pendentes: [unichar] = []
    var viuEspaco = false
    var temGeometria = false

    for i in 0..<total {
      let u = ns.character(at: i)
      if ehSeparador(u) {
        if let t = trecho {
          itens.append(montarItem(t, pagina: numero))
          trecho = nil
        }
        viuEspaco = true
        continue
      }
      let r = pagina.characterBounds(at: i)
      let valido = !r.isNull && !r.isInfinite && !r.isEmpty && r.minX.isFinite && r.minY.isFinite && r.width.isFinite && r.height.isFinite
      if !valido {
        if trecho != nil {
          trecho!.unidades.append(u)
        } else {
          pendentes.append(u)
        }
        continue
      }
      temGeometria = true
      // Tamanho da fonte: do texto atribuido (so se tiver o mesmo comprimento de `string`); senao, a altura da caixa / 1,2.
      var tam = r.height / 1.2
      if fontesAlinhadas, let fonte = atributos!.attribute(.font, at: i, effectiveRange: nil) as? UIFont, fonte.pointSize >= 3, fonte.pointSize <= 200 {
        tam = fonte.pointSize
      }
      if var t = trecho {
        let tamRef = max(t.tamanho, tam)
        let mudouLinha = abs(r.midY - t.yMeio) > 0.45 * tamRef
        let folga = r.minX - t.xFim
        let salto = folga > 0.15 * tamRef || folga < -0.5 * tamRef
        if !mudouLinha && !salto {
          t.unidades.append(u)
          t.xFim = max(t.xFim, r.maxX)
          t.yMin = min(t.yMin, r.minY)
          t.tamanho = tamRef
          trecho = t
          continue
        }
        itens.append(montarItem(t, pagina: numero))
        trecho = nil
      }
      var novo = TrechoAberto()
      novo.unidades = pendentes + [u]
      pendentes = []
      novo.espacoAntes = viuEspaco
      viuEspaco = false
      novo.x0 = r.minX
      novo.xFim = r.maxX
      novo.yMin = r.minY
      novo.yMeio = r.midY
      novo.tamanho = tam
      trecho = novo
    }
    if let t = trecho {
      itens.append(montarItem(t, pagina: numero))
    }
    if !pendentes.isEmpty && !itens.isEmpty {
      // Caracteres sem geometria no fim da pagina acompanham o ultimo trecho.
      let resto = String(decoding: pendentes, as: UTF16.self).replacingOccurrences(of: "\u{0000}", with: "a")
      itens[itens.count - 1].str += resto
    }
    if !temGeometria {
      // O PDFKit nao informou a posicao de nenhum caractere: devolve as linhas do texto, de cima para baixo, sem colunas.
      var y: Double = 800
      for linha in texto.components(separatedBy: .newlines) {
        let limpa = linha.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: "\u{0000}", with: "a")
        if limpa.isEmpty { continue }
        var o = ItemPdfNativo()
        o.str = limpa
        o.x = 0
        o.y = y
        o.largura = 0
        o.tamanho = 10
        o.pagina = numero
        itens.append(o)
        y -= 14
      }
    }
    return itens
  }

  // MARK: - Vision

  private static func reconhecer(_ imagem: CGImage, orientacao: CGImagePropertyOrientation, pagina: Int) throws -> [ObservacaoOcr] {
    let pedido = VNRecognizeTextRequest()
    pedido.recognitionLevel = .accurate
    // Nomes de estabelecimentos e codigos nao sao palavras de dicionario; a correcao automatica poderia reescreve-los.
    pedido.usesLanguageCorrection = false
    if let suportados = try? pedido.supportedRecognitionLanguages(), suportados.contains("pt-BR") {
      pedido.recognitionLanguages = ["pt-BR"]
    }
    let handler = VNImageRequestHandler(cgImage: imagem, orientation: orientacao, options: [:])
    do {
      try handler.perform([pedido])
    } catch {
      throw OcrFalhaException("Falha no reconhecimento de texto: \(error.localizedDescription)")
    }
    var saida: [ObservacaoOcr] = []
    for obs in pedido.results ?? [] {
      guard let candidato = obs.topCandidates(1).first else { continue }
      var o = ObservacaoOcr()
      o.texto = candidato.string
      o.confianca = Double(candidato.confidence)
      o.x = Double(obs.boundingBox.minX)
      o.y = Double(obs.boundingBox.minY)
      o.largura = Double(obs.boundingBox.width)
      o.altura = Double(obs.boundingBox.height)
      o.pagina = pagina
      saida.append(o)
    }
    return saida
  }

  private static func orientacao(_ o: UIImage.Orientation) -> CGImagePropertyOrientation {
    switch o {
    case .up: return .up
    case .upMirrored: return .upMirrored
    case .down: return .down
    case .downMirrored: return .downMirrored
    case .left: return .left
    case .leftMirrored: return .leftMirrored
    case .right: return .right
    case .rightMirrored: return .rightMirrored
    @unknown default: return .up
    }
  }
}

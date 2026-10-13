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
    AsyncFunction("reconhecer") { (uri: String) throws -> [ObservacaoOcr] in
      guard let url = URL(string: uri), url.isFileURL else {
        throw OcrFalhaException("O arquivo precisa ser local.")
      }
      guard FileManager.default.isReadableFile(atPath: url.path) else {
        throw OcrFalhaException("Nao foi possivel ler o arquivo.")
      }
      if url.pathExtension.lowercased() == "pdf" {
        return try OcrNativoModule.reconhecerPdf(url)
      }
      return try OcrNativoModule.reconhecerImagem(url)
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

  private static func reconhecerPdf(_ url: URL) throws -> [ObservacaoOcr] {
    guard let doc = PDFDocument(url: url) else {
      throw OcrFalhaException("PDF ilegivel.")
    }
    if doc.isLocked {
      throw OcrFalhaException("PDF protegido por senha.")
    }
    if doc.pageCount > maxPaginas {
      throw OcrFalhaException("PDF com mais de \(maxPaginas) paginas.")
    }
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

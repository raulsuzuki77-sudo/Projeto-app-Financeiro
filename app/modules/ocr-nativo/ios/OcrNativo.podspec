Pod::Spec.new do |s|
  s.name           = 'OcrNativo'
  s.version        = '1.0.0'
  s.summary        = 'OCR local de imagens e PDFs com Vision e PDFKit'
  s.description    = 'Reconhece texto de fotos e PDFs inteiramente no aparelho (sem rede).'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = {
    :ios => '16.4',
    :tvos => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end

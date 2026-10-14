Pod::Spec.new do |s|
  s.name           = 'PastaNativa'
  s.version        = '1.0.0'
  s.summary        = 'Acesso persistente a uma pasta escolhida pelo usuario (Arquivos do iPhone)'
  s.description    = 'Guarda a permissao de uma pasta (bookmark de escopo seguro) para ler documentos e gravar backups nela, sem rede.'
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

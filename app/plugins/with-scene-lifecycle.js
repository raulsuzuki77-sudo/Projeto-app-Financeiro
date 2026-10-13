/**
 * Adota o ciclo de vida baseado em UIScene no projeto iOS gerado pelo `expo prebuild`.
 *
 * Por que existe: apps compilados com o SDK do iOS 27 (Xcode 27) fecham ao abrir com a mensagem
 * "UIScene life cycle is required for apps built with this SDK". O template do Expo SDK 57 ainda
 * nao inclui essa adocao, embora o codigo nativo do pacote `expo` 57.0.28 ja traga
 * `ExpoAppSceneDelegate` e `ExpoReactNativeFactoryProvider`. Este plugin aplica a mesma alteracao
 * que o template do Expo SDK 58 faz:
 *   1. Info.plist: UIApplicationSceneManifest apontando para SceneDelegate;
 *   2. SceneDelegate.swift (subclasse de ExpoAppSceneDelegate) incluido no alvo do Xcode;
 *   3. AppDelegate.swift: passa a conformar com ExpoReactNativeFactoryProvider e deixa de criar a janela
 *      (a janela e criada pelo SceneDelegate).
 * Idempotente: se o projeto ja adotar scenes (por exemplo apos atualizar o Expo), nada e alterado.
 * Pode ser removido quando o template do SDK em uso ja incluir scenes.
 */
const fs = require("fs");
const path = require("path");
const { withInfoPlist, withDangerousMod, withXcodeProject, IOSConfig } = require("expo/config-plugins");

const SCENE_DELEGATE_SWIFT = `internal import Expo

@objc(SceneDelegate)
class SceneDelegate: ExpoAppSceneDelegate {
  // Extension point for config plugins.
}
`;

const MANIFEST = {
  UIApplicationSupportsMultipleScenes: false,
  UISceneConfigurations: {
    UIWindowSceneSessionRoleApplication: [
      {
        UISceneConfigurationName: "Default Configuration",
        UISceneDelegateClassName: "$(PRODUCT_MODULE_NAME).SceneDelegate",
      },
    ],
  },
};

// Trecho do template do SDK 57 que cria a janela e inicia o React Native (substituido pelo SceneDelegate).
const BLOCO_JANELA = /#if os\(iOS\) \|\| os\(tvOS\)\s*\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\s*\n\s*factory\.startReactNative\(\s*\n\s*withModuleName: "main",\s*\n\s*in: window,\s*\n\s*launchOptions: launchOptions\)\s*\n#endif\s*\n/;

function ajustarAppDelegate(conteudo) {
  if (conteudo.includes("ExpoReactNativeFactoryProvider")) return { conteudo, alterado: false };
  let novo = conteudo.replace(
    /class AppDelegate: ExpoAppDelegate \{/,
    "class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {",
  );
  if (novo === conteudo) throw new Error("with-scene-lifecycle: declaracao 'class AppDelegate: ExpoAppDelegate' nao encontrada; o template mudou, revise o plugin.");
  const semJanela = novo.replace(
    BLOCO_JANELA,
    "    // A janela e criada e o React Native e iniciado pelo `SceneDelegate` sob o ciclo de vida por scenes\n    // (exigido pelo SDK do iOS 27).\n",
  );
  if (semJanela === novo) throw new Error("with-scene-lifecycle: bloco de criacao da janela nao encontrado no AppDelegate; o template mudou, revise o plugin.");
  return { conteudo: semJanela, alterado: true };
}

module.exports = function withSceneLifecycle(config) {
  // 1. Info.plist
  config = withInfoPlist(config, (c) => {
    if (!c.modResults.UIApplicationSceneManifest) c.modResults.UIApplicationSceneManifest = MANIFEST;
    return c;
  });

  // 2. Arquivos Swift
  config = withDangerousMod(config, [
    "ios",
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, c.modRequest.projectName);
      const appDelegate = path.join(dir, "AppDelegate.swift");
      const r = ajustarAppDelegate(fs.readFileSync(appDelegate, "utf8"));
      if (r.alterado) fs.writeFileSync(appDelegate, r.conteudo);
      const scene = path.join(dir, "SceneDelegate.swift");
      if (!fs.existsSync(scene)) fs.writeFileSync(scene, SCENE_DELEGATE_SWIFT);
      return c;
    },
  ]);

  // 3. Inclui SceneDelegate.swift no alvo de compilacao do Xcode
  config = withXcodeProject(config, (c) => {
    const nome = c.modRequest.projectName;
    const arquivo = `${nome}/SceneDelegate.swift`;
    const ja = Object.values(c.modResults.pbxFileReferenceSection()).some((f) => typeof f === "object" && String(f.path).replace(/"/g, "") === "SceneDelegate.swift");
    if (!ja) IOSConfig.XcodeUtils.addBuildSourceFileToGroup({ filepath: arquivo, groupName: nome, project: c.modResults });
    return c;
  });

  return config;
};

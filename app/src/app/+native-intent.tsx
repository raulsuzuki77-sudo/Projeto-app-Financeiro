/**
 * Arquivos recebidos do menu Compartilhar / "Abrir em..." chegam como uma URL de arquivo (file://...).
 * Em vez de o roteador tentar tratá-la como rota, redirecionamos para a tela de importação já com o arquivo.
 */
export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  if (/^file:/i.test(path) || /\/Inbox\//.test(path)) {
    const nome = decodeURIComponent(path.split("/").pop() ?? "arquivo");
    return `/importar?uri=${encodeURIComponent(path)}&nome=${encodeURIComponent(nome)}`;
  }
  return path;
}

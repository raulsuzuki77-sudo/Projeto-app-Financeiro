import * as DocumentPicker from "expo-document-picker";
import { useState } from "react";
import { Text, View } from "react-native";
import { ROTULO_CLASSE } from "../../../core/src/index";
import { useTema } from "./tema";
import { useToast } from "./toast";
import { Aviso, Botao, Campo, Cartao, Texto } from "./ui";
import type { DadosLiberdade } from "../lib/api";
import { api } from "../lib/api";
import { dataBR, formatarBRL } from "../lib/format";
import { ErroPdfProtegido, formatarMoeda, lerArquivoDeExtrato, lerTaxaCambio, textoTaxa, type LeituraDoArquivo } from "../lib/investimentos";

type Arquivo = { uri: string; nome: string };

function Linha({ rotulo, valor, destaque }: { rotulo: string; valor: string; destaque?: string }) {
  const t = useTema();
  return (
    <View accessible accessibilityLabel={`${rotulo}: ${valor}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 12, minHeight: 24 }}>
      <Text style={{ color: t.suave, fontSize: 14, flexShrink: 1 }}>{rotulo}</Text>
      <Text style={{ color: destaque ?? t.texto, fontSize: 14, fontWeight: "600", textAlign: "right", flexShrink: 1 }}>{valor}</Text>
    </View>
  );
}

/**
 * Importação de extrato em PDF: lê, mostra a prévia (nada é gravado) e só grava depois de "Confirmar e salvar".
 */
export function LiberdadeImportar({ extratos, cambios, aoSalvar }: { extratos: DadosLiberdade["extratos"]; cambios: DadosLiberdade["cambios"]; aoSalvar: (mesDoExtrato: string) => void }) {
  const t = useTema();
  const toast = useToast();
  const [arquivo, setArquivo] = useState<Arquivo | null>(null);
  const [senha, setSenha] = useState("");
  const [pedirSenha, setPedirSenha] = useState<null | "pedida" | "incorreta">(null);
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [leitura, setLeitura] = useState<LeituraDoArquivo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [taxa, setTaxa] = useState("");
  const [verPosicoes, setVerPosicoes] = useState(false);

  const extrato = leitura && leitura.resultado.ok ? leitura.resultado.extrato : null;
  const mesDoExtrato = extrato ? extrato.periodo_fim.slice(0, 7) : "";

  function limpar() {
    setArquivo(null);
    setSenha("");
    setPedirSenha(null);
    setLeitura(null);
    setErro(null);
    setTaxa("");
    setVerPosicoes(false);
  }

  async function ler(a: Arquivo, s: string | null) {
    setLendo(true);
    setErro(null);
    setLeitura(null);
    try {
      const r = await lerArquivoDeExtrato(a.uri, s);
      setPedirSenha(null);
      if (!r.resultado.ok) {
        setErro(r.resultado.erro);
        return;
      }
      const ex = r.resultado.extrato;
      const existente = cambios.find((c) => c.mes === ex.periodo_fim.slice(0, 7) && c.moeda === ex.moeda);
      setTaxa(existente ? textoTaxa(existente.taxa_x10000) : "");
      setLeitura(r);
    } catch (e) {
      if (e instanceof ErroPdfProtegido) setPedirSenha(e.incorreta ? "incorreta" : "pedida");
      else setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      setLendo(false);
    }
  }

  async function escolher() {
    const r = await DocumentPicker.getDocumentAsync({ type: ["application/pdf"], copyToCacheDirectory: true, multiple: false });
    if (r.canceled || r.assets.length === 0) return;
    const a = { uri: r.assets[0]!.uri, nome: r.assets[0]!.name };
    limpar();
    setArquivo(a);
    await ler(a, null);
  }

  const precisaTaxa = !!extrato && extrato.moeda !== "BRL";
  const taxaLida = lerTaxaCambio(taxa);
  const divergente = !!extrato && extrato.conferencia.confere === false;

  async function confirmar() {
    if (!extrato || !leitura) return;
    if (precisaTaxa && taxaLida === null) return setErro("Informe a taxa de câmbio do mês (por exemplo 5,4321).");
    setSalvando(true);
    setErro(null);
    try {
      const r = await api.salvarExtratoInvestimento(extrato, leitura.hash);
      if (r.status === "ja_importado") {
        toast({ texto: "Este extrato já havia sido importado; nada foi alterado." });
      } else {
        if (precisaTaxa && taxaLida !== null) await api.definirCambio(mesDoExtrato, extrato.moeda, taxaLida);
        toast({ texto: `Extrato salvo: ${r.posicoes} posições e ${r.movimentos} movimentos${r.substituidas > 0 ? `; ${r.substituidas} posições anteriores do mesmo mês e conta foram substituídas` : ""}.` });
      }
      limpar();
      aoSalvar(mesDoExtrato);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar o extrato.");
    } finally {
      setSalvando(false);
    }
  }

  const substitui = !!extrato && extratos.some((x) => x.instituicao === extrato.instituicao && x.conta === extrato.conta && x.moeda === extrato.moeda && x.periodo_fim.slice(0, 7) === mesDoExtrato);
  const c = extrato?.conferencia;

  return (
    <Cartao titulo="Importar extrato (PDF)">
      {!arquivo ? (
        <Texto suave>Escolha o PDF do extrato. Hoje a leitura cobre o Extrato da Conta Investimento do BTG Pactual (Brasil) e o Account Statement da BTG Pactual US (em dólares). O arquivo é lido neste aparelho e nada é gravado antes da sua confirmação.</Texto>
      ) : (
        <Text style={{ color: t.texto, fontSize: 15, fontWeight: "600" }} numberOfLines={2}>{arquivo.nome}</Text>
      )}
      <Botao rotulo={arquivo ? "Escolher outro PDF" : "Escolher PDF do extrato"} icone="importar" secundario={!!arquivo} onPress={escolher} carregando={lendo} />

      {pedirSenha ? (
        <View style={{ gap: 8 }}>
          <Aviso tipo="info">{pedirSenha === "incorreta" ? "A senha informada não abriu o PDF. Confira e tente de novo." : "Este PDF é protegido por senha. Informe-a abaixo."}</Aviso>
          <Campo rotulo="Senha do PDF" value={senha} onChangeText={setSenha} secureTextEntry autoCapitalize="none" autoCorrect={false} />
          <Botao rotulo="Abrir com esta senha" onPress={() => arquivo && ler(arquivo, senha)} desabilitado={!senha || lendo} />
        </View>
      ) : null}

      {erro ? <Aviso tipo="erro">{erro}</Aviso> : null}

      {extrato && leitura && c ? (
        <View style={{ gap: 12 }}>
          <Text accessibilityRole="header" style={{ color: t.texto, fontSize: 16, fontWeight: "700" }}>Prévia do que foi lido</Text>
          {leitura.jaImportado ? <Aviso tipo="info">Este arquivo já foi importado antes (mesmo conteúdo). Nada será gravado de novo.</Aviso> : null}
          {!leitura.jaImportado && substitui ? <Aviso tipo="info">Já existem posições de {mesDoExtrato.slice(5)}/{mesDoExtrato.slice(0, 4)} para esta instituição e conta. Ao confirmar, elas serão substituídas pelas deste extrato.</Aviso> : null}
          <View style={{ gap: 2 }}>
            <Linha rotulo="Instituição" valor={extrato.instituicao} />
            <Linha rotulo="Conta" valor={extrato.conta ? `final ${extrato.conta}` : "não identificada"} />
            <Linha rotulo="Período" valor={`${dataBR(extrato.periodo_inicio)} a ${dataBR(extrato.periodo_fim)}`} />
            <Linha rotulo="Moeda" valor={extrato.moeda === "USD" ? "Dólar (US$)" : "Real (R$)"} />
            <Linha rotulo="Posições lidas" valor={String(extrato.posicoes.length)} />
            <Linha rotulo="Movimentos lidos" valor={String(extrato.movimentos.length)} />
            <Linha rotulo="Total declarado no extrato" valor={c.total_declarado_centavos === null ? "não localizado" : formatarMoeda(c.total_declarado_centavos, extrato.moeda, formatarBRL)} />
            <Linha rotulo="Soma das posições lidas" valor={formatarMoeda(c.soma_posicoes_centavos, extrato.moeda, formatarBRL)} />
            <Linha rotulo="Diferença" valor={c.diferenca_centavos === null ? "sem total para comparar" : formatarMoeda(c.diferenca_centavos, extrato.moeda, formatarBRL)} destaque={c.confere === false ? t.perigo : c.confere ? t.ok : undefined} />
          </View>
          {c.confere ? <Text style={{ color: t.ok, fontSize: 14, fontWeight: "600" }}>Confere: a soma das posições é igual ao total declarado.</Text> : null}
          {c.confere === false ? <Aviso tipo="erro">{`A soma das posições lidas difere do total declarado no extrato. Confira o PDF antes de salvar; se confirmar assim mesmo, a divergência fica registrada neste aviso, não nos números.`}</Aviso> : null}
          {c.confere === null ? <Aviso tipo="info">O total declarado não foi localizado, então a soma não pôde ser conferida.</Aviso> : null}

          {c.parciais.length > 0 ? (
            <View style={{ gap: 2 }}>
              <Texto suave pequeno>Conferências parciais</Texto>
              {c.parciais.map((p) => (
                <View key={p.rotulo} accessible accessibilityLabel={`${p.rotulo}: ${p.confere ? "confere" : `diverge em ${formatarMoeda(p.diferenca_centavos, extrato.moeda, formatarBRL)}`}`} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
                  <Text style={{ color: t.suave, fontSize: 13, flex: 1 }}>{p.rotulo}</Text>
                  <Text style={{ color: p.confere ? t.ok : t.perigo, fontSize: 13, fontWeight: "600" }}>{p.confere ? `confere (${formatarMoeda(p.declarado_centavos, extrato.moeda, formatarBRL)})` : `diverge ${formatarMoeda(p.diferenca_centavos, extrato.moeda, formatarBRL)}`}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {extrato.avisos.map((a, i) => <Aviso key={i} tipo="info">{a}</Aviso>)}

          <Botao rotulo={verPosicoes ? "Ocultar posições lidas" : "Ver posições lidas"} pequeno secundario onPress={() => setVerPosicoes(!verPosicoes)} />
          {verPosicoes ? (
            <View style={{ gap: 4 }}>
              {extrato.posicoes.map((p, i) => (
                <View key={i} accessible accessibilityLabel={`${p.ativo}: ${formatarMoeda(p.valor_centavos, extrato.moeda, formatarBRL)}`} style={{ flexDirection: "row", gap: 8, justifyContent: "space-between" }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: t.texto, fontSize: 13 }}>{p.ativo}</Text>
                    <Text style={{ color: t.suave, fontSize: 11 }}>{ROTULO_CLASSE[p.classe_ativo]}{p.codigo ? ` · ${p.codigo}` : ""}{p.quantidade !== null ? ` · ${String(p.quantidade).replace(".", ",")} un.` : ""}</Text>
                  </View>
                  <Text style={{ color: t.texto, fontSize: 13, fontWeight: "600" }}>{formatarMoeda(p.valor_centavos, extrato.moeda, formatarBRL)}</Text>
                </View>
              ))}
            </View>
          ) : null}

          {precisaTaxa ? (
            <View style={{ gap: 6 }}>
              <Campo rotulo={`Taxa de câmbio do mês (reais por ${extrato.moeda === "USD" ? "dólar" : extrato.moeda})`} prefixo="R$" placeholder="0,0000" keyboardType="decimal-pad" value={taxa} onChangeText={setTaxa} />
              <Texto suave pequeno>É a taxa do dólar que você considera para converter este extrato em reais, por exemplo a do último dia do mês. Ela vale para {mesDoExtrato.slice(5)}/{mesDoExtrato.slice(0, 4)} e pode ser alterada depois em Câmbio.</Texto>
              {taxa.trim() !== "" && taxaLida === null ? <Aviso tipo="erro">Taxa inválida. Use números como 5,4321.</Aviso> : null}
            </View>
          ) : null}

          <Botao rotulo={divergente ? "Salvar mesmo com divergência" : "Confirmar e salvar"} onPress={confirmar} carregando={salvando} desabilitado={leitura.jaImportado || (precisaTaxa && taxaLida === null)} perigo={divergente} />
          <Botao rotulo="Cancelar" secundario onPress={limpar} desabilitado={salvando} />
        </View>
      ) : null}
    </Cartao>
  );
}

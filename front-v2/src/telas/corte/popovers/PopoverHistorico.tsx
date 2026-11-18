import { Botao, Dica, GrupoAjuste, Status, tc } from '@ds'
import { Redo2, Save, Undo2 } from 'lucide-react'
import { useEffect } from 'react'
import { useSessaoEditorCorte, type SessaoEditorCorte } from '~/telas/corte/PalcoEditor'

export type PopoverHistoricoProps = {
  projetoPath?: string | null
  corteId?: string | null
  estadoEditor?: SessaoEditorCorte
}

export function PopoverHistorico({
  projetoPath = null,
  corteId = null,
  estadoEditor,
}: PopoverHistoricoProps) {
  const editor = useSessaoEditorCorte(projetoPath, corteId, estadoEditor)
  const doc = editor.documentoAtivo
  const snapshots = editor.snapshots
  const dirty = editor.dirty
  const salvando = editor.salvando
  const erroSalvamento = editor.erroSalvamento
  const storeAtivo = editor.store
  const clipId = doc?.clipId ?? null
  const revision = doc?.revision ?? null

  useEffect(() => {
    if (clipId !== null) {
      void storeAtivo.carregarSnapshots()
    }
  }, [clipId, dirty, revision, storeAtivo])

  const undoCount = doc?.undoCount ?? 0
  const redoCount = doc?.redoCount ?? 0

  return (
    <div className="flex flex-col gap-3 text-pequeno">
      <GrupoAjuste rotulo="Pilha do Corte atual">
        <div className="flex gap-2">
          <Dica texto="Desfazer edição no Corte atual" atalho="Ctrl+Z">
            <Botao
              tamanho="p"
              variante="secundario"
              icone={<Undo2 />}
              disabled={undoCount === 0}
              onClick={() => void storeAtivo.desfazerEditor()}
              className="flex-1 justify-center"
            >
              Desfazer (<span className="num">{undoCount}</span>)
            </Botao>
          </Dica>
          <Dica texto="Refazer edição no Corte atual" atalho="Ctrl+Shift+Z">
            <Botao
              tamanho="p"
              variante="secundario"
              icone={<Redo2 />}
              disabled={redoCount === 0}
              onClick={() => void storeAtivo.refazerEditor()}
              className="flex-1 justify-center"
            >
              Refazer (<span className="num">{redoCount}</span>)
            </Botao>
          </Dica>
        </div>
        <div className="flex items-center justify-between gap-2">
          <Status tom={erroSalvamento ? 'perigo' : dirty ? 'pendente' : 'sucesso'}>
            {erroSalvamento
              ? 'Falha ao salvar'
              : salvando
                ? 'Salvando…'
                : dirty
                  ? 'Alterações pendentes'
                  : 'Salvo'}
          </Status>
          <Dica texto="Gravar alterações no Projeto agora" atalho="Ctrl+S">
            <Botao
              tamanho="p"
              variante="secundario"
              icone={<Save />}
              carregando={salvando}
              onClick={() => void storeAtivo.salvarAgora()}
            >
              Salvar agora
            </Botao>
          </Dica>
        </div>
      </GrupoAjuste>

      <div className="flex flex-col gap-1 rounded-controle bg-area p-2">
        <span className="font-medio text-t1">Fora do Desfazer do Corte</span>
        <p className="text-t3">
          Sugestões automáticas do YuNet, estilo/destaques/tradução de legenda e correções da Transcrição (pilha do Projeto) não entram no Desfazer da timeline.
        </p>
      </div>

      <GrupoAjuste
        rotulo="Snapshots salvos"
        valor={<span className="num">{snapshots.length}</span>}
      >
        <p className="text-micro text-t3">
          Histórico informativo de salvamentos em modo somente leitura (até 20 versões).
        </p>

        {snapshots.length === 0 ? (
          <p className="text-t3">Nenhum snapshot gravado ainda.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
            {snapshots.map((snap) => (
              <li
                key={snap.snapshot_id}
                className="flex items-center justify-between gap-2 rounded-controle bg-area p-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="num font-medio text-t1">
                    Rev. {snap.revision} · {tc(snap.range.startUs)} – {tc(snap.range.endUs)}
                  </div>
                  <div className="num text-micro text-t3">
                    Layout: {snap.crop.layout ?? 'fit'} · Silêncios:{' '}
                    {snap.silences?.intervals?.length ?? 0}
                  </div>
                </div>
                <Dica texto="Restauração direta de snapshot aguarda comando editor.snapshots.restore no núcleo (#294).">
                  <span tabIndex={0} className="inline-flex">
                    <Botao tamanho="p" disabled>
                      Restaurar
                    </Botao>
                  </span>
                </Dica>
              </li>
            ))}
          </ul>
        )}
      </GrupoAjuste>
    </div>
  )
}

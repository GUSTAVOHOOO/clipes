import { ProvedorDicas, ProvedorToast, Tela } from '@ds'

export function App() {
  return (
    <ProvedorDicas>
      <ProvedorToast>
        <Tela titulo="Clipes" mostrarEtapas={false}>
          <main className="flex-1" />
        </Tela>
      </ProvedorToast>
    </ProvedorDicas>
  )
}

/// <reference types="node" />
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

const loadMain = async () => {
  try {
    const bunTest = (await import('bun:test' as string)) as {
      mock?: { module?: (id: string, factory: () => unknown) => void };
    };
    bunTest.mock?.module?.('@/lib/drawers', () => ({ drawers: [] }));
  } catch {
    // fora do Bun
  }
  return import('./main');
};

describe('registrarFechamentoV1', () => {
  it('é no-op fora do Tauri', async () => {
    const { registrarFechamentoV1 } = await loadMain();
    let listenCalls = 0;
    const parar = registrarFechamentoV1({
      isTauri: () => false,
      listen: (async () => {
        listenCalls += 1;
        return () => {};
      }) as never,
      getCurrentWindow: (() => ({ destroy: async () => {} })) as never,
    });

    assert.equal(listenCalls, 0);
    parar();
  });

  it('registra um único listener de app-close-requested, envia app-close-ack e chama getCurrentWindow().destroy()', async () => {
    const { registrarFechamentoV1 } = await loadMain();
    let listenCalls = 0;
    let unlistenCalls = 0;
    const ordem: string[] = [];
    let handler: ((event: unknown) => void) | undefined;

    const fakeListen = async (eventName: string, cb: (event: unknown) => void) => {
      assert.equal(eventName, 'app-close-requested');
      listenCalls += 1;
      handler = cb;
      return () => {
        unlistenCalls += 1;
      };
    };

    const fakeEmit = async (eventName: string) => {
      assert.equal(eventName, 'app-close-ack');
      ordem.push('ack');
    };

    const fakeGetCurrentWindow = () => ({
      destroy: async () => {
        ordem.push('destroy');
      },
    });

    const parar1 = registrarFechamentoV1({
      isTauri: () => true,
      listen: fakeListen as never,
      emit: fakeEmit as never,
      getCurrentWindow: fakeGetCurrentWindow as never,
    });
    const parar2 = registrarFechamentoV1({
      isTauri: () => true,
      listen: fakeListen as never,
      emit: fakeEmit as never,
      getCurrentWindow: fakeGetCurrentWindow as never,
    });

    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.equal(listenCalls, 1);
    if (!handler) {
      throw new Error('handler de app-close-requested deve ter sido registrado');
    }

    handler({ event: 'app-close-requested', id: 1, payload: null });
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.deepEqual(ordem, ['ack', 'destroy']);

    parar1();
    assert.equal(unlistenCalls, 0);
    parar2();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(unlistenCalls, 1);
  });
});

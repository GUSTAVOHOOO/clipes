"""Mensagens JSON lines do protocolo v1 (worker/protocol/README.md)."""

import json

PROTOCOL_VERSION = 1

# Mensagens de erro fixas por código: nunca carregam caminhos nem texto de exceção.
ERROR_MESSAGES = {
    "invalid_message": "Mensagem inválida.",
    "protocol_mismatch": "Versão do protocolo incompatível.",
    "unknown_task": "Tarefa desconhecida.",
    "model_missing": "O modelo necessário não está instalado.",
    "out_of_memory": "Memória insuficiente para carregar o modelo.",
    "cancelled": "Tarefa cancelada.",
    "internal": "Erro interno do worker.",
}


class WorkerError(Exception):
    """Erro tipado: o código é um dos de ERROR_MESSAGES."""

    def __init__(self, code):
        super().__init__(code)
        assert code in ERROR_MESSAGES
        self.code = code


def encode(message):
    return json.dumps(message, ensure_ascii=False, separators=(",", ":"))


def decode(line):
    """Decodifica uma linha; levanta WorkerError('invalid_message') se não for um objeto com v e type."""
    try:
        message = json.loads(line)
    except ValueError:
        raise WorkerError("invalid_message") from None
    if (
        not isinstance(message, dict)
        or message.get("v") != PROTOCOL_VERSION
        or not isinstance(message.get("type"), str)
    ):
        raise WorkerError("invalid_message")
    return message


def error_message(request_id, code):
    return {
        "v": PROTOCOL_VERSION,
        "type": "error",
        "id": request_id,
        "code": code,
        "message": ERROR_MESSAGES[code],
    }

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";

function App() {
  const [version, setVersion] = useState<string>();
  const [error, setError] = useState(false);
  useEffect(() => {
    invoke<{ version: string }>("core_dispatch", { name: "app.version", arguments: {} })
      .then((result) => setVersion(result.version))
      .catch(() => setError(true));
  }, []);
  return <main><h1>Clipes</h1><p>{error ? "Não foi possível carregar a versão." : version ? `Versão ${version}` : "Carregando versão…"}</p></main>;
}

createRoot(document.getElementById("root")!).render(<App />);

import { useCallback, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { toImportPayload } from "../components/DownloadOptions.jsx";
import { useToast } from "../toast/ToastProvider.jsx";

/**
 * Kick off an import and hand the user to the progress page.
 *
 * The success message goes through the toast provider, which lives above the
 * router — setting page-local state and navigating in the same tick used to
 * unmount the message before it ever rendered.
 */
export function useImportRunner() {
  const nav = useNavigate();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async ({ url, ids, titles = {}, options, navigate = true }) => {
      if (!ids?.length) {
        toast.info("Selecione ao menos um vídeo.");
        return null;
      }
      setBusy(true);
      try {
        const data = await api.importVideos({
          url,
          videoIds: ids,
          titles,
          ...toImportPayload(options),
        });
        toast.ok(
          `${ids.length} vídeo(s) na fila — baixando e enviando ao Spotify.`
        );
        if (navigate) nav("/progress");
        return data;
      } catch (e) {
        toast.error(e.message || "Não consegui iniciar o import.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [nav, toast]
  );

  return { run, busy };
}

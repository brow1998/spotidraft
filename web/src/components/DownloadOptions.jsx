export const DEFAULT_DOWNLOAD_OPTIONS = {
  audioOnly: false,
  withThumb: true,
  withDescription: true,
  // 1080p by default: "best" pulls 4K, which measured 2166 MB against 401 MB at
  // 1080p for the same video — 5.4x the bytes to download, store and upload,
  // for something Spotify re-encodes anyway.
  maxHeight: "1080",
};

/**
 * The four download switches, shared by the Home shelf and the Import page.
 *
 * @param {object} props
 * @param {typeof DEFAULT_DOWNLOAD_OPTIONS} props.value
 * @param {(next: object) => void} props.onChange receives the full next object
 * @param {boolean} [props.compact] tighter layout for the Home cog popover
 */
export function DownloadOptions({ value, onChange, compact = false }) {
  const set = (patch) => onChange({ ...value, ...patch });

  return (
    <div className={compact ? "options options-compact" : "options"}>
      <label>
        <input
          type="checkbox"
          checked={value.audioOnly}
          onChange={(e) => set({ audioOnly: e.target.checked })}
        />
        Só áudio
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.withThumb}
          onChange={(e) => set({ withThumb: e.target.checked })}
          disabled={value.audioOnly}
        />
        Thumbnail
      </label>
      <label>
        <input
          type="checkbox"
          checked={value.withDescription}
          onChange={(e) => set({ withDescription: e.target.checked })}
        />
        Descrição
      </label>
      <label className="options-quality">
        Qualidade
        <select
          value={value.maxHeight}
          onChange={(e) => set({ maxHeight: e.target.value })}
          disabled={value.audioOnly}
        >
          <option value="1080">1080p (recomendado)</option>
          <option value="720">720p (mais leve)</option>
          <option value="480">480p</option>
          <option value="">Melhor disponível (pode ser 4K)</option>
        </select>
      </label>
    </div>
  );
}

/** Shape the options into the payload /api/import expects. */
export function toImportPayload(options) {
  return {
    audioOnly: options.audioOnly,
    withThumb: options.withThumb,
    withDescription: options.withDescription,
    maxHeight: options.maxHeight ? Number(options.maxHeight) : null,
  };
}

export default DownloadOptions;

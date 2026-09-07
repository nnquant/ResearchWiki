import { useUi } from '../app/UiContext';

export function ImageLightbox() {
  const { lightbox, closeImage } = useUi();
  if (!lightbox) return null;
  return (
    <div className="lightbox" onClick={closeImage} role="dialog" aria-label="图片预览">
      <img src={lightbox.src} alt={lightbox.alt} />
      {lightbox.alt && <div className="caption">{lightbox.alt}</div>}
    </div>
  );
}

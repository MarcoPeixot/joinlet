import { WATERCOLOR_DEFS } from '../diagram/watercolor';

export function WatercolorDefs() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden dangerouslySetInnerHTML={{ __html: WATERCOLOR_DEFS }} />
  );
}

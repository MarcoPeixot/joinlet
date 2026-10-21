import { uiText } from '../i18n';
import { ITEM_LIST } from '@strukt/workspace';
import { useWorkspace } from '../workspace/appWorkspace';

/** The page's level-one heading, visible only to assistive technology: the app's name and what the main area shows. */
export function PageHeading() {
  const view = useWorkspace((s) => s.view);
  const diagram = useWorkspace((s) => s.diagram);
  const slug = view.kind === 'diagram' ? diagram : view.kind === 'board' ? null : view.slug;
  const kind = view.kind === 'diagram' || view.kind === 'board' ? 'diagram' : view.kind;
  const title = useWorkspace((s) => (slug ? s.data?.manifest[ITEM_LIST[kind]].find((entry) => entry.slug === slug)?.title : undefined));
  const what = view.kind === 'board' ? 'Overview' : title;
  return <h1 className="sr-only">{what ? `Joinlet — ${what}` : "Joinlet"}</h1>;
}

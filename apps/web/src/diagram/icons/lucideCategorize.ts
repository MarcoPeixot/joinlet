import { uiText } from '../../i18n';
/**
 * The icon picker's category for a Lucide icon name (`scripts/build-lucide-categories.ts` writes the result for
 * every icon into `lucide-categories.json`). No installed package ships Lucide's categories (`lucide` has only the
 * glyphs; `@iconify-json/lucide` has neither categories nor tags), so they come from a documented heuristic over
 * the kebab-case names:
 *   1. `OVERRIDES` fixes the names the rules below would misfile.
 *   2. A `cloud-…` name with a weather word (`cloud-rain`) is weather; any other cloud is network.
 *   3. Container words (`circle-user`, `square-code`, `badge-dollar-sign`) are skipped, then the first word
 *      found in `WORDS` decides (`file-lock` → files: Lucide names start with the main object).
 *   4. A name made only of container words (`square-dashed`) is a shape; anything else is `misc`.
 */

const CONTAINERS = new Set(['circle', 'square', 'squares', 'squircle', 'octagon', 'badge', 'hexagon', 'pentagon', 'diamond', 'triangle']);
const WEATHER = new Set(['rain', 'drizzle', 'snow', 'hail', 'fog', 'lightning', 'sun', 'moon', 'sunny']);

/** Category id → the words that put a name in it; a word listed twice counts for its first category. */
const CATEGORY_WORDS: Record<string, string[]> = {
  arrows: ['arrow', 'arrows', 'chevron', 'chevrons', 'move', 'corner', 'undo', 'redo', 'refresh', 'rotate', 'repeat', 'shuffle', 'iteration', 'split', 'merge', 'between'],
  interface: [
    'layout', 'panel', 'panels', 'grid', 'columns', 'rows', 'menu', 'toggle', 'sliders', 'settings', 'search', 'zoom', 'check', 'x', 'ellipsis', 'grip',
    'loader', 'maximize', 'minimize', 'fullscreen', 'expand', 'shrink', 'scaling', 'app', 'external', 'link', 'unlink', 'eye', 'view', 'funnel', 'pointer',
    'info', 'alert', 'question', 'exclamation', 'flag', 'thumbs', 'power', 'command', 'option', 'delete', 'trash', 'separator', 'gap', 'group', 'ungroup',
    'combine', 'frame', 'crop', 'proportions', 'ratio', 'lasso', 'crosshair', 'focus', 'dock', 'ban', 'copy', 'fold', 'unfold', 'picture', 'bookmark',
    'star', 'heart', 'sparkle', 'sparkles', 'blinds', 'wallpaper', 'stretch', 'kanban', 'slash', 'target', 'tally',
  ],
  development: [
    'code', 'terminal', 'bug', 'git', 'braces', 'brackets', 'binary', 'regex', 'variable', 'webhook', 'component', 'blocks', 'container', 'workflow',
    'function', 'lambda', 'bot', 'puzzle', 'package', 'box', 'boxes', 'diff', 'logs', 'cog', 'parentheses', 'robot',
  ],
  data: ['database', 'table', 'chart', 'sheet', 'pie', 'gauge', 'trending', 'activity', 'layers', 'layer', 'cylinder', 'axis', 'timeline'],
  network: [
    'cloud', 'server', 'network', 'wifi', 'router', 'ethernet', 'cable', 'signal', 'radio', 'satellite', 'rss', 'bluetooth', 'nfc', 'antenna', 'cast',
    'globe', 'waypoints', 'unplug', 'plug', 'hdmi', 'usb', 'airplay', 'radar',
  ],
  devices: [
    'monitor', 'laptop', 'smartphone', 'tablet', 'keyboard', 'mouse', 'printer', 'cpu', 'tv', 'watch', 'battery', 'gamepad', 'headphones', 'headphone',
    'headset', 'speaker', 'webcam', 'projector', 'memory', 'microchip', 'hard', 'computer', 'pc', 'touchpad', 'joystick', 'calculator', 'gpu', 'circuit',
    'vibrate', 'fan', 'heater', 'refrigerator', 'microwave', 'washing', 'lamp', 'lightbulb', 'flashlight', 'drone', 'air', 'blender', 'shredder', 'cctv',
    'goggles', uiText("sim"),
  ],
  files: [
    'file', 'files', 'folder', 'folders', 'archive', 'clipboard', 'paperclip', 'save', 'book', 'notebook', 'notepad', 'library', 'sticky', 'newspaper',
    'scroll', 'import', 'download', 'upload', 'form', 'paper', 'summary', 'inspection',
  ],
  communication: [
    'mail', 'mails', 'message', 'messages', 'phone', 'send', 'inbox', 'at', 'bell', 'megaphone', 'voicemail', 'share', 'reply', 'forward', 'speech',
    'mailbox', 'vote', 'presentation', 'lectern', 'podium', 'ticket', 'tickets',
  ],
  people: [
    'user', 'users', 'person', 'baby', 'hand', 'smile', 'frown', 'laugh', 'meh', 'annoyed', 'angry', 'accessibility', 'contact', 'ear', 'mouth',
    'footprints', 'biceps', 'brain', 'venus', 'mars', 'transgender', 'non', 'handshake', 'glasses', 'shirt', 'crown', 'hat', 'face', 'graduation',
  ],
  security: ['shield', 'lock', 'unlock', 'key', 'fingerprint', 'scan', 'siren', 'id', 'vault', 'fence', 'biohazard', 'radiation', 'door'],
  maps: [
    'map', 'pin', 'navigation', 'compass', 'earth', 'locate', 'route', 'signpost', 'milestone', 'landmark', 'building', 'house', 'houses', 'hotel',
    'hospital', 'church', 'castle', 'factory', 'warehouse', 'tent', 'mountain', 'parking', 'park', 'road', 'bridge', 'dam', 'lighthouse', 'tower',
    'university', 'mosque', 'school', 'theater', 'traffic', 'concierge', 'utility', 'dome',
  ],
  time: ['clock', 'calendar', 'calendars', 'timer', 'alarm', 'hourglass', 'history', 'watch', 'metronome'],
  media: [
    'play', 'pause', 'stop', 'music', 'video', 'videotape', 'film', 'image', 'images', 'camera', 'mic', 'volume', 'audio', 'clapperboard', 'skip',
    'rewind', 'fast', 'gallery', 'aperture', 'drum', 'guitar', 'piano', 'clef', 'midi', 'eject', 'captions', 'drama', 'popcorn', 'step', 'disc',
    'cassette', 'turntable', 'boom', 'spotlight', 'podcast',
  ],
  text: [
    'text', 'type', 'bold', 'italic', 'underline', 'heading', 'align', 'list', 'pilcrow', 'quote', 'strikethrough', 'subscript', 'superscript', 'case',
    'spell', 'wrap', 'indent', 'remove', 'a', 'whole', 'baseline', 'ligature', 'languages', 'signature', 'section', 'space', 'replace', 'ampersand',
    'ampersands', 'letter',
  ],
  math: [
    'sigma', 'pi', 'omega', 'phi', 'radical', 'divide', 'percent', 'infinity', 'decimals', 'equal', 'plus', 'minus', 'hash', 'asterisk', 'diameter',
    'radius', 'tangent', 'angle',
  ],
  shapes: [
    'circle', 'square', 'triangle', 'hexagon', 'octagon', 'pentagon', 'diamond', 'shapes', 'cone', 'torus', 'pyramid', 'spline', 'squircle', 'rectangle',
    'ellipse', 'cuboid', 'dot', 'squares', 'triangles', 'origami', 'astroid', 'blend', 'vector',
  ],
  weather: [
    'sun', 'moon', 'cloudy', 'snowflake', 'wind', 'thermometer', 'umbrella', 'rainbow', 'sunrise', 'sunset', 'tornado', 'droplet', 'droplets', 'waves',
    'haze', 'eclipse', 'solar', 'zap', 'flame', 'fire', 'parasol',
  ],
  finance: [
    'wallet', 'credit', 'banknote', 'coins', 'dollar', 'euro', 'pound', 'cent', 'bitcoin', 'shopping', 'receipt', 'tag', 'tags', 'piggy', 'currency',
    'gem', 'gift', 'barcode', 'indian', 'japanese', 'philippine', 'russian', 'saudi', 'swiss', 'turkish', 'georgian', 'nepali', 'scale', 'briefcase',
    'store', 'handbag', 'qr', 'card', 'stamp', 'weight',
  ],
  transport: [
    'car', 'bus', 'truck', 'plane', 'ship', 'train', 'bike', 'sailboat', 'tram', 'rocket', 'fuel', 'caravan', 'tractor', 'forklift', 'ambulance',
    'scooter', 'motorbike', 'van', 'helicopter', 'ev', 'trailer', 'kayak', 'luggage', 'baggage', 'anchor', 'engine',
  ],
  nature: [
    'leaf', 'leafy', 'tree', 'trees', 'flower', 'sprout', 'shrub', 'plant', 'clover', 'rose', 'shell', 'snail', 'turtle', 'rabbit', 'rat', 'cat',
    'dog', 'bird', 'birdhouse', 'fish', 'shrimp', 'squirrel', 'panda', 'worm', 'paw', 'bone', 'feather', 'atom', 'dna', 'microscope', 'telescope',
    'test', 'flask', 'beaker', 'magnet', 'orbit', 'galaxy', 'lens', 'stone', 'fishing', 'recycle',
  ],
  health: ['pill', 'syringe', 'stethoscope', 'bandage', 'iv', 'tablets', 'cross', 'germ', 'virus', 'toothbrush', 'soap', 'dumbbell'],
  food: [
    'coffee', 'pizza', 'beer', 'wine', 'cake', 'cookie', 'egg', 'salad', 'sandwich', 'carrot', 'cherry', 'grape', 'citrus', 'banana', 'apple',
    'croissant', 'cupcake', 'dessert', 'donut', 'drumstick', 'ham', 'hamburger', 'ice', 'lollipop', 'candy', 'milk', 'popsicle', 'soup', 'utensils',
    'chef', 'cooking', 'cup', 'glass', 'martini', 'beef', 'bean', 'broccoli', 'bottle', 'vegan', 'slice', 'can', 'carton', 'wheat', 'hop',
  ],
  tools: [
    'wrench', 'hammer', 'drill', 'pickaxe', 'shovel', 'axe', 'ruler', 'scissors', 'paintbrush', 'paint', 'pen', 'pencil', 'brush', 'eraser',
    'highlighter', 'palette', 'pipette', 'wand', 'toolbox', 'tool', 'construction', 'anvil', 'nut', 'bolt', 'spray', 'swatch', 'drafting', 'broom',
    'mop', 'spool', 'contrast', 'sticker', 'shelving', 'barrel',
  ],
  games: [
    'dice', 'dices', 'chess', 'playing', 'spade', 'club', 'trophy', 'medal', 'award', 'volleyball', 'goal', 'tic', 'toy', 'party', 'balloon',
    'ferris', 'roller', 'bow', 'sport', 'rocking', 'whistle', 'ribbon', 'sword', 'swords', 'bomb',
  ],
};

/** Names the word rules would misfile (`mouse-pointer` is a cursor, not a device). */
const OVERRIDES: Record<string, string> = {
  'mouse-pointer': 'interface',
  'mouse-pointer-2': 'interface',
  'mouse-pointer-2-off': 'interface',
  'mouse-pointer-ban': 'interface',
  'mouse-pointer-click': 'interface',
  'square-mouse-pointer': 'interface',
  'square-dashed-mouse-pointer': 'interface',
  'hand-coins': 'finance',
  'hand-platter': 'food',
  'heart-pulse': 'health',
  'heart-crack': 'people',
  'heart-handshake': 'people',
  'bone-fracture': 'health',
  'hard-hat': 'tools',
  'pocket-knife': 'tools',
  'cable-car': 'transport',
  'container-ship': 'transport',
  'scan-text': 'text',
  'scan-barcode': 'finance',
  'scan-qr-code': 'finance',
  'alarm-smoke': 'security',
  'brick-wall-fire': 'security',
  'brick-wall-shield': 'security',
  'mountain-snow': 'nature',
  'tent-tree': 'nature',
  'list-music': 'media',
  'list-video': 'media',
  'land-plot': 'maps',
  'fire-extinguisher': 'tools',
  'screen-share': 'communication',
  'screen-share-off': 'communication',
  'send-to-back': 'interface',
  'bring-to-front': 'interface',
  'table-of-contents': 'text',
  'robot-vacuum': 'devices',
  'log-in': 'interface',
  'log-out': 'interface',
  'life-buoy': 'interface',
  'closed-caption': 'media',
  'hd': 'media',
  'binoculars': 'maps',
  'copyright': 'text',
  'copyleft': 'text',
  'creative-commons': 'text',
  'line-squiggle': 'shapes',
  'line-style': 'tools',
  'gavel': 'finance',
};

const WORDS = new Map<string, string>();
for (const [category, words] of Object.entries(CATEGORY_WORDS)) {
  for (const word of words) if (!WORDS.has(word)) WORDS.set(word, category);
}

export function categorize(name: string): string {
  if (Object.hasOwn(OVERRIDES, name)) return OVERRIDES[name]!;
  const words = name.split('-');
  if (words.includes('cloud')) return words.some((w) => WEATHER.has(w)) ? 'weather' : 'network';
  const meaningful = words.filter((w) => !CONTAINERS.has(w));
  for (const word of meaningful) {
    const category = WORDS.get(word);
    if (category) return category;
  }
  return words.some((w) => CONTAINERS.has(w)) ? 'shapes' : 'misc';
}

// AF-459: 韵律管线对外入口（业务层只从这里 import）.
export { buildProsodyPlan } from './prosody-plan.js';
export { applyProsodyToSentence } from './prosody-inject.js';
export { ProsodyStreamSanitizer, renderMiniMaxText, stripProsodyMarkers } from './prosody-text.js';
export type {
  ProsodyApplyContext,
  ProsodyEvent,
  ProsodyEventAnchor,
  ProsodyEventKind,
  ProsodyLevel,
  ProsodyPlanInput,
  ProsodySentenceResult,
  ProsodyTurnLimits,
  ProsodyTurnPlan,
} from './prosody.types.js';

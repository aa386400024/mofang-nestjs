export {
  REALISM_SCENES,
  REALISM_STATE_BANDS,
  VISITOR_TURN_SHAPES,
  VISITOR_VOICE_ROLES,
  resolveRealismScene,
  resolveRealismStateBand,
  resolveVisitorVoiceRole,
  selectTurnShape,
  type RealismScene,
  type RealismStateBand,
  type SceneSource,
  type StateSource,
  type TurnShapeInput,
  type VisitorTurnShape,
  type VisitorVoiceRole,
  type VoiceSource,
} from './turn-shape-selector.js';

export {
  buildVisitorRealismProfile,
  buildVisitorRealismPromptBlock,
  parseDisfluencyLevel,
  parseRealismMode,
  type DisfluencyLevel,
  type RealismMode,
  type RealismQuotas,
  type VisitorRealismContext,
  type VisitorRealismProfile,
} from './visitor-realism-profile.js';

export {
  REALISM_EVENT_KINDS,
  buildRealismEventPlan,
  buildRealismEventPromptLine,
  type RealismEventKind,
  type RealismEventOption,
  type RealismEventPlan,
  type RealismEventQuotaSource,
} from './realism-event-plan.js';

export {
  resolveRealismEventRhythm,
  type RealismEventRhythm,
  type RealismPauseStyle,
  type RealismRepairPosition,
  type RealismShortAnswerBias,
} from './realism-event-rhythm.js';

export {
  buildRealismRetryInstruction,
  countRealismEvents,
  inspectRealismEventDistribution,
  inspectVisitorRealism,
  measureVisitorTurnLength,
  type RealismAuditProfile,
  type RealismAuditResult,
  type RealismEventDistribution,
  type RealismPauseSpanClass,
  type RealismRepairPositionClass,
  type RealismSignal,
  type RealismViolation,
} from './visitor-realism-audit.js';

export {
  PROMPT_ECHO_MARKERS,
  inspectVisitorRegister,
  type RegisterAuditProfile,
  type RegisterAuditResult,
  type RegisterSignal,
  type RegisterViolation,
} from './visitor-register-audit.js';

export { stripVisitorStageDirections } from './visitor-stage-direction.js';

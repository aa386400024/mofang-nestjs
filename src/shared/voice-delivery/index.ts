// AF-460: 语音交付层对外入口（业务层与调试页只从这里 import）.
export { buildVoiceDeliveryProfile } from './voice-delivery.profile.js';
export { normalizeDeliveryDifficulty, normalizeDeliveryEmotion, normalizeDeliveryStyle } from './voice-delivery.types.js';
export {
  DOUBAO_2_CAPABILITIES,
  MINIMAX_CAPABILITIES,
  renderDoubaoDelivery,
  renderMiniMaxDelivery,
  toDoubaoAudioParams,
  toMiniMaxEmotion,
  toMiniMaxVoiceSetting,
} from './voice-delivery.render.js';
export type {
  DeliveryDifficulty,
  DeliveryEmotion,
  DeliveryStyle,
  VoiceDeliveryInput,
  VoiceDeliveryProfile,
} from './voice-delivery.types.js';
export type { VoiceDeliveryRenderResult, VoiceDeliveryRendererCapabilities } from './voice-delivery.render.js';

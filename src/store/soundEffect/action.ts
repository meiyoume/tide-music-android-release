import state, { type InitState } from './state'

export default {
  setState(info: Partial<InitState>) {
    Object.assign(state, info)
    global.state_event.soundEffectUpdated({ ...state })
  },
}

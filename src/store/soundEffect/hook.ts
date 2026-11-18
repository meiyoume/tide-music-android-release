import { useEffect, useState } from 'react'
import state, { type InitState } from './state'

export const useSoundEffectState = (): InitState => {
  const [info, setInfo] = useState(state)

  useEffect(() => {
    global.state_event.on('soundEffectUpdated', setInfo)
    return () => {
      global.state_event.off('soundEffectUpdated', setInfo)
    }
  }, [])

  return info
}

import { memo, useState, useEffect, useRef } from 'react'

import { StyleSheet, View, Keyboard } from 'react-native'
import type { InputType, InputProps } from '@/components/common/Input'
import Input from '@/components/common/Input'
import { useTheme } from '@/store/theme/hook'
import { useSettingValue } from '@/store/setting/hook'
import { useTokens } from '@/harmony/useTokens'
import { SET_LABEL_SIZE, SET_LABEL_TRACK, SET_ROW_PAD_X, SET_ROW_SIZE } from '@/harmony/tokens'
import Text from '@/components/common/Text'


export interface InputItemProps extends InputProps {
  value: string
  label: string
  onChanged: (text: string, callback: (vlaue: string) => void) => void
}

/**
 * 设置页里的文本输入项
 *
 * 潮汐壳层开着时用界面那套：小字浅灰标签（同分组标题）+ 内嵌输入框
 * （页面底色填充 + 圆角），对应界面里 `.searchbox` 的观感。
 * 关掉壳层退回安卓版原样式。
 *
 * 与 Button 一样，上一版这里没有分支，输入框一直是内核主题的深色块 ——
 * 在潮汐卡片里像贴了块补丁。
 */
export default memo(({ value, label, onChanged, ...props }: InputItemProps) => {
  const [text, setText] = useState(value)
  const textRef = useRef(value)
  const isMountRef = useRef(false)
  const inputRef = useRef<InputType>(null)
  const theme = useTheme()
  const harmonyShell = useSettingValue('harmonyShell')
  const t = useTokens()
  const saveValue = () => {
    onChanged?.(text, (value: string) => {
      if (!isMountRef.current) return
      const newValue = String(value)
      setText(newValue)
      textRef.current = newValue
    })
  }
  useEffect(() => {
    isMountRef.current = true
    return () => {
      isMountRef.current = false
    }
  }, [])
  useEffect(() => {
    const handleKeyboardDidHide = () => {
      if (!inputRef.current?.isFocused()) return
      onChanged?.(textRef.current, value => {
        if (!isMountRef.current) return
        const newValue = String(value)
        setText(newValue)
        textRef.current = newValue
      })
    }
    const keyboardDidHide = Keyboard.addListener('keyboardDidHide', handleKeyboardDidHide)

    return () => {
      keyboardDidHide.remove()
    }
  }, [onChanged])
  useEffect(() => {
    if (value != text) {
      const newValue = String(value)
      setText(newValue)
      textRef.current = newValue
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])
  const handleSetSelectMode = (text: string) => {
    setText(text)
    textRef.current = text
  }

  if (harmonyShell) {
    return (
      <View style={harmonyStyles.container}>
        <Text style={[harmonyStyles.label, { color: t.textWeak }]}>{label}</Text>
        <Input
          value={text}
          ref={inputRef}
          onChangeText={handleSetSelectMode}
          style={{ ...harmonyStyles.input, backgroundColor: t.fillSoft }}
          {...props}
          onBlur={saveValue}
        />
      </View>
    )
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label} size={14}>{label}</Text>
      <Input
        value={text}
        ref={inputRef}
        onChangeText={handleSetSelectMode}
        style={{ ...styles.input, backgroundColor: theme['c-primary-input-background'] }}
        {...props}
        onBlur={saveValue}
       />
    </View>
  )
})

const styles = StyleSheet.create({
  container: {
    paddingLeft: 25,
    marginBottom: 15,
  },
  label: {
    marginBottom: 2,
  },
  input: {
    backgroundColor: 'rgba(0,0,0,0.2)',
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 4,
    // paddingTop: 3,
    // paddingBottom: 3,
    maxWidth: 300,
  },
})

/** 潮汐形态：小字标签 + 内嵌输入框（版式抄界面 `.s-row` 与 `.searchbox`） */
const harmonyStyles = StyleSheet.create({
  container: {
    paddingLeft: SET_ROW_PAD_X,
    paddingRight: SET_ROW_PAD_X,
    paddingTop: 12,
    paddingBottom: 12,
  },
  label: {
    fontSize: SET_LABEL_SIZE,
    fontWeight: '600',
    letterSpacing: SET_LABEL_TRACK,
    marginBottom: 7,
  },
  input: {
    flexGrow: 1,
    flexShrink: 1,
    borderRadius: 12,
    paddingLeft: 12,
    paddingRight: 12,
    fontSize: SET_ROW_SIZE,
    // 卡片里的输入框不再限宽：卡片本身已经限过宽度了
    maxWidth: '100%',
  },
})

'use client'

import { useCallback, useRef, useState } from 'react'
import { call } from '@/lib/backend'
import { commands } from '@koharu/bridge/protocol'
import { toast } from '@koharu/ui/components/toast'

export function useSpeechPlayback() {
  const [playingLayerId, setPlayingLayerId] = useState<string | null>(null)
  const [synthesizingLayerId, setSynthesizingLayerId] = useState<string | null>(null)

  const audioContextRef = useRef<AudioContext | null>(null)
  const activeSourceRef = useRef<AudioBufferSourceNode | null>(null)
  const currentTokenRef = useRef<number>(0)

  const stop = useCallback(() => {
    currentTokenRef.current += 1
    if (activeSourceRef.current) {
      try {
        activeSourceRef.current.stop()
      } catch {
        // Source might have already finished
      }
      activeSourceRef.current = null
    }
    setPlayingLayerId(null)
    setSynthesizingLayerId(null)
  }, [])

  const speak = useCallback(
    async (layerId: string, text: string) => {
      const cleanText = text.trim()
      if (!cleanText) return

      // If already playing this layer, clicking again stops it
      if (playingLayerId === layerId || synthesizingLayerId === layerId) {
        stop()
        return
      }

      // Stop any existing playback (concurrency: interrupt previous)
      stop()

      const token = ++currentTokenRef.current
      setSynthesizingLayerId(layerId)

      try {
        // Call backend synthesis (Rust forwarder)
        const audioBytes = await call(commands.synthesizeSpeech, cleanText, null, null)

        // If request was interrupted while synthesizing
        if (token !== currentTokenRef.current) return

        setSynthesizingLayerId(null)

        // Initialize or resume AudioContext
        let ctx = audioContextRef.current
        if (!ctx || ctx.state === 'closed') {
          ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
          audioContextRef.current = ctx
        }
        if (ctx.state === 'suspended') {
          await ctx.resume()
        }

        // Convert number[] to ArrayBuffer
        const u8 = new Uint8Array(audioBytes)
        const audioBuffer = await ctx.decodeAudioData(u8.buffer)

        // Interrupted while decoding
        if (token !== currentTokenRef.current) return

        const source = ctx.createBufferSource()
        source.buffer = audioBuffer
        source.connect(ctx.destination)

        source.onended = () => {
          if (token === currentTokenRef.current) {
            setPlayingLayerId(null)
            activeSourceRef.current = null
          }
        }

        activeSourceRef.current = source
        setPlayingLayerId(layerId)
        source.start(0)
      } catch (err) {
        if (token === currentTokenRef.current) {
          setSynthesizingLayerId(null)
          setPlayingLayerId(null)
          toast.add({
            type: 'error',
            title: 'Speech synthesis failed',
            description: typeof err === 'string' ? err : err instanceof Error ? err.message : undefined,
          })
        }
      }
    },
    [playingLayerId, synthesizingLayerId, stop],
  )

  return {
    speak,
    stop,
    playingLayerId,
    synthesizingLayerId,
  }
}

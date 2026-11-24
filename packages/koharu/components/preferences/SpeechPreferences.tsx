'use client'

import { CheckCircle2, Play, RefreshCw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PreferencePage,
  PreferenceRow,
  PreferenceSection,
} from '@/components/preferences/PreferenceFields'
import { commands, type SpeechConfig, type VoiceSpeaker } from '@koharu/ipc/protocol'
import { Button } from '@koharu/ui/components/button'
import { Input } from '@koharu/ui/components/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@koharu/ui/components/select'
import { Slider } from '@koharu/ui/components/slider'
import { toast } from '@koharu/ui/components/toast'

export function SpeechPreferences({
  value,
  onChange,
}: {
  value: SpeechConfig
  onChange: (next: SpeechConfig) => void
}) {
  const { t } = useTranslation()
  const [speakers, setSpeakers] = useState<VoiceSpeaker[]>([])
  const [serviceStatus, setServiceStatus] = useState<{
    running: boolean
    message: string | null
  } | null>(null)
  const [checking, setChecking] = useState(false)
  const [starting, setStarting] = useState(false)

  const checkStatus = useCallback(async () => {
    setChecking(true)
    try {
      const status = await commands.checkSpeechService(value.endpoint)
      setServiceStatus(status)
      if (status.running) {
        const list = await commands.getSpeechSpeakers(value.endpoint)
        setSpeakers(list)
      }
    } catch {
      setServiceStatus({ running: false, message: '連線失敗' })
    } finally {
      setChecking(false)
    }
  }, [value.endpoint])

  useEffect(() => {
    void checkStatus()
  }, [checkStatus])

  const handleStartService = async () => {
    setStarting(true)
    try {
      const status = await commands.startSpeechService(value.executable_path)
      setServiceStatus(status)
      if (status.running) {
        toast.add({ type: 'success', title: t('speech.serviceStarted', 'VOICEVOX 服務已啟動') })
        const list = await commands.getSpeechSpeakers(value.endpoint)
        setSpeakers(list)
      } else {
        toast.add({
          type: 'error',
          title: t('speech.startFailed', '啟動服務失敗'),
          description: status.message ?? undefined,
        })
      }
    } catch (err) {
      toast.add({
        type: 'error',
        title: '啟動服務失敗',
        description: err instanceof Error ? err.message : String(err),
      })
    } finally {
      setStarting(false)
    }
  }

  // Flat list of speaker style choices
  const speakerOptions = speakers.flatMap((speaker) =>
    speaker.styles.map((style) => ({
      id: style.id,
      label: `${speaker.name} (${style.name})`,
    })),
  )

  return (
    <PreferencePage
      title={t('speech.title', '語音朗讀 (Speech)')}
      description={t('speech.description', '配置 VOICEVOX 朗讀服務、角色聲線與發音速度。')}
    >
      <PreferenceSection
        title={t('speech.serviceSection', 'VOICEVOX 服務')}
        description={t('speech.serviceDescription', '管理本機語音引擎連線與背景進程。')}
      >
        <PreferenceRow
          title={t('speech.status', '服務狀態')}
          description={
            serviceStatus?.running
              ? (serviceStatus.message ?? t('speech.running', '服務運行中'))
              : t('speech.notRunning', '未連線或未啟動')
          }
        >
          <div className='flex items-center gap-2'>
            {serviceStatus?.running ? (
              <span className='flex items-center gap-1 text-[11px] font-medium text-emerald-500'>
                <CheckCircle2 className='size-3.5' />
                {t('speech.online', '在線')}
              </span>
            ) : (
              <span className='flex items-center gap-1 text-[11px] font-medium text-muted-foreground'>
                <XCircle className='size-3.5' />
                {t('speech.offline', '離線')}
              </span>
            )}
            <Button
              variant='outline'
              size='xs'
              disabled={checking}
              onClick={() => void checkStatus()}
              className='gap-1'
            >
              <RefreshCw className={`size-3 ${checking ? 'animate-spin' : ''}`} />
              {t('speech.check', '檢查')}
            </Button>
            {!serviceStatus?.running && (
              <Button
                variant='default'
                size='xs'
                disabled={starting}
                onClick={() => void handleStartService()}
                className='gap-1'
              >
                <Play className='size-3' />
                {starting ? t('speech.starting', '啟動中…') : t('speech.startService', '啟動服務')}
              </Button>
            )}
          </div>
        </PreferenceRow>

        <PreferenceRow
          title={t('speech.executablePath', 'VOICEVOX 路徑')}
          description={t('speech.executablePathDescription', '本機 run.exe 檔案的絕對路徑。')}
        >
          <Input
            value={value.executable_path}
            onChange={(e) => onChange({ ...value, executable_path: e.target.value })}
            placeholder='G:\voicevox-engine\run.exe'
            className='w-72 text-right'
          />
        </PreferenceRow>

        <PreferenceRow
          title={t('speech.endpoint', 'API 端點 (Endpoint)')}
          description={t('speech.endpointDescription', 'VOICEVOX 引擎的 HTTP API 位址。')}
        >
          <Input
            value={value.endpoint}
            onChange={(e) => onChange({ ...value, endpoint: e.target.value })}
            placeholder='http://127.0.0.1:50021'
            className='w-56 text-right'
          />
        </PreferenceRow>
      </PreferenceSection>

      <PreferenceSection
        title={t('speech.voiceSection', '聲音與角色設定')}
        description={t('speech.voiceDescription', '選取預設朗讀聲線與語速。')}
      >
        <PreferenceRow
          title={t('speech.speaker', '朗讀角色與風格')}
          description={t('speech.speakerDescription', '點擊屬性面板原文朗讀時所使用的聲音。')}
        >
          <Select
            value={String(value.speaker_id)}
            onValueChange={(val) => val && onChange({ ...value, speaker_id: Number(val) })}
            disabled={speakerOptions.length === 0}
          >
            <SelectTrigger className='w-60'>
              <SelectValue placeholder={t('speech.selectSpeaker', '選擇角色聲線')} />
            </SelectTrigger>
            <SelectContent>
              {speakerOptions.map((opt) => (
                <SelectItem key={opt.id} value={String(opt.id)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </PreferenceRow>

        <PreferenceRow
          title={t('speech.speed', '朗讀語速')}
          description={`${Math.round(value.speed_scale * 100)}%`}
        >
          <div className='flex w-48 items-center gap-3'>
            <Slider
              min={50}
              max={200}
              step={5}
              value={Math.round(value.speed_scale * 100)}
              onValueChange={(val) => {
                const num = typeof val === 'number' ? val : val[0]
                if (num !== undefined) onChange({ ...value, speed_scale: num / 100 })
              }}
            />
          </div>
        </PreferenceRow>
      </PreferenceSection>
    </PreferencePage>
  )
}

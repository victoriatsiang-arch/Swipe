'use client'

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import dynamic from 'next/dynamic'

const PDFViewer = dynamic<{
  file?: File | string | null
  scrollable?: boolean
  pageNumber?: number
  onDocumentLoad?: (numPages: number) => void
}>(() => import('../../components/PDFViewertemp').then((mod) => mod.default), {
  ssr: false,
})

type PresentationMessage =
  | { type: 'REQUEST_STATE'; senderId: string }
  | { type: 'FILE_URL'; senderId: string; url: string }
  | {
      type: 'PAGE_UPDATE'
      senderId: string
      page: number
      totalPages: number
    }
  | { type: 'END_SESSION'; senderId: string }

const CHANNEL_NAME = 'presentation-control'

export default function PresenterPage() {
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const latestTotalsRef = useRef(1)
  const windowId = useMemo(() => crypto.randomUUID(), [])

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current?.srcObject) {
      ;(videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((track) => track.stop())
      videoRef.current.srcObject = null
    }
  }, [])

  const sendMessage = useCallback(
    (message: Omit<PresentationMessage, 'senderId'>) => {
      channelRef.current?.postMessage({ ...message, senderId: windowId })
    },
    [windowId]
  )

  const goToPage = useCallback(
    (updater: number | ((prev: number) => number)) => {
      setCurrentPage((prevPage) => {
        const total = latestTotalsRef.current || 1
        const target =
          typeof updater === 'function' ? updater(prevPage) : updater
        const next = Math.max(1, Math.min(target, total))
        if (next !== prevPage) {
          sendMessage({ type: 'PAGE_UPDATE', page: next, totalPages: total })
        }
        return next
      })
    },
    [sendMessage]
  )

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      latestTotalsRef.current = numPages
      setTotalPages(numPages)
      setCurrentPage((prevPage) => {
        const next = Math.min(prevPage, numPages)
        sendMessage({ type: 'PAGE_UPDATE', page: next, totalPages: numPages })
        return next
      })
    },
    [sendMessage]
  )

  const handlePresenterExit = useCallback(() => {
    sendMessage({ type: 'END_SESSION' })
    stopCamera()
    window.close()
  }, [sendMessage, stopCamera])

  useEffect(() => {
    latestTotalsRef.current = totalPages
  }, [totalPages])

  useEffect(() => {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<PresentationMessage>) => {
      const data = event.data
      if (!data || data.senderId === windowId) {
        return
      }
      switch (data.type) {
        case 'FILE_URL':
          setPdfUrl(data.url)
          break
        case 'PAGE_UPDATE':
          if (typeof data.page === 'number') {
            setCurrentPage(data.page)
          }
          if (typeof data.totalPages === 'number') {
            latestTotalsRef.current = data.totalPages
            setTotalPages(data.totalPages)
          }
          break
        case 'END_SESSION':
          stopCamera()
          window.close()
          break
        default:
          break
      }
    }

    channel.addEventListener('message', handleMessage)
    channel.postMessage({ type: 'REQUEST_STATE', senderId: windowId })

    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [stopCamera, windowId])

  useEffect(() => {
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        cameraStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      })
      .catch(() =>
        alert('Unable to access the camera in the presenter window.')
      )

    return () => {
      sendMessage({ type: 'END_SESSION' })
      stopCamera()
    }
  }, [sendMessage, stopCamera])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
        e.preventDefault()
        goToPage((prev) => prev + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        goToPage((prev) => prev - 1)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [goToPage])

  return (
    <main className="w-full h-screen flex bg-secondary-foreground text-background">
      <section className="w-[30%] h-full bg-secondary-foreground flex items-center justify-center p-4">
        <video
          ref={videoRef}
          className="w-full h-full object-contain rounded-xl border border-tertiary/60 bg-secondary-foreground"
          autoPlay
          playsInline
          muted
        />
      </section>
      <section className="flex-1 h-full relative bg-tertiary flex flex-col">
        <div className="absolute top-4 right-4 flex gap-3 z-10">
          <button
            className="px-4 py-2 rounded bg-tertiary text-secondary-foreground hover:opacity-90 transition"
            onClick={() => goToPage((prev) => prev - 1)}
          >
            Previous
          </button>
          <button
            className="px-4 py-2 rounded bg-primary text-background hover:bg-primary-hover transition"
            onClick={() => goToPage((prev) => prev + 1)}
          >
            Next
          </button>
          <button
            className="px-4 py-2 rounded bg-destructive text-background hover:opacity-90 transition"
            onClick={handlePresenterExit}
          >
            End
          </button>
        </div>
        <div
          className="flex-1 flex items-center justify-center px-6 cursor-pointer"
          onClick={() => goToPage((prev) => prev + 1)}
        >
          <div className="w-full h-full max-w-5xl">
            <PDFViewer
              file={pdfUrl}
              pageNumber={currentPage}
              scrollable={false}
              onDocumentLoad={handleDocumentLoad}
            />
          </div>
        </div>
        <footer className="py-4 text-center text-sm text-secondary-foreground/70 bg-tertiary">
          Click anywhere on the slide or use the arrow keys to advance.
        </footer>
      </section>
    </main>
  )
}


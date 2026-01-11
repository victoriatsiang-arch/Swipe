'use client'

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import dynamic from 'next/dynamic'

// Dynamically import the PDFViewer to avoid SSR issues
const PDFViewer = dynamic<{
  file?: File | string | null
  scrollable?: boolean
  pageNumber?: number
  onDocumentLoad?: (numPages: number) => void
}>(() => import('../components/PDFViewertemp').then((mod) => mod.default), {
  ssr: false,
})

const SLIDES = [
  {
    id: 0,
    title: 'Welcome to Swipe',
    body: 'We are a blah blah blah, overview;',
  },
  {
    id: 1,
    title: 'Upload a PDF',
    body: 'Start by uploading a PDF in the viewer.',
  },
  {
    id: 2,
    title: 'To Start, Give a Thumbs Up!',
    body: '',
    notes: 'Test your gestures here.',
  },
  {
    id: 3,
    title: 'Setup Complete',
    body: 'Would you like to begin presentation?',
  },
]

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

export default function WelcomeSlidesPage() {
  const [index, setIndex] = useState<number>(0)
  const [pdfFile, setPdfFile] = useState<File | null>(null)
  const [presentationMode, setPresentationMode] = useState(false)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)

  const [cameraActive, setCameraActive] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const presenterWindowRef = useRef<Window | null>(null)
  const channelRef = useRef<BroadcastChannel | null>(null)
  const latestStateRef = useRef<{
    currentPage: number
    totalPages: number
    pdfUrl: string | null
  }>({
    currentPage: 1,
    totalPages: 1,
    pdfUrl: null,
  })
  const windowId = useMemo(() => crypto.randomUUID(), [])

  const slideCount = SLIDES.length
  const clampIndex = useCallback(
    (i: number) => Math.max(0, Math.min(i, slideCount - 1)),
    [slideCount]
  )
  const dotDisabled = (i: number) => i > 1 && !pdfFile

  const goTo = useCallback(
    (i: number) => {
      if (i > 1 && !pdfFile) {
        alert('Please upload a PDF before continuing.')
        return
      }
      setIndex(clampIndex(i))
    },
    [clampIndex, pdfFile]
  )

  const next = useCallback(() => {
    const newIndex = clampIndex(index + 1)
    if (newIndex > 1 && !pdfFile) {
      alert('Please upload a PDF before continuing.')
      return
    }
    setIndex(newIndex)
  }, [clampIndex, index, pdfFile])

  const prev = useCallback(
    () => setIndex((i) => clampIndex(i - 1)),
    [clampIndex]
  )

  const stopCamera = useCallback(() => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop())
      cameraStreamRef.current = null
    }
    if (videoRef.current?.srcObject) {
      ;(videoRef.current.srcObject as MediaStream)
        .getTracks()
        .forEach((t) => t.stop())
      videoRef.current.srcObject = null
    }
  }, [])

  const emitFileUrl = useCallback(() => {
    if (!pdfUrl) {
      return
    }
    channelRef.current?.postMessage({
      type: 'FILE_URL',
      url: pdfUrl,
      senderId: windowId,
    })
  }, [pdfUrl, windowId])

  const emitPageUpdate = useCallback(
    (page: number, total: number) => {
      channelRef.current?.postMessage({
        type: 'PAGE_UPDATE',
        page,
        totalPages: total,
        senderId: windowId,
      })
    },
    [windowId]
  )

  const emitEndSession = useCallback(() => {
    channelRef.current?.postMessage({
      type: 'END_SESSION',
      senderId: windowId,
    })
  }, [windowId])

  type PageUpdater = number | ((prev: number) => number)
  const goToPage = useCallback(
    (updater: PageUpdater, options?: { broadcast?: boolean }) => {
      const shouldBroadcast = options?.broadcast ?? presentationMode
      setCurrentPage((prevPage) => {
        const total = latestStateRef.current.totalPages || 1
        const target =
          typeof updater === 'function' ? updater(prevPage) : updater
        const next = Math.max(1, Math.min(target, total))
        if (shouldBroadcast && next !== prevPage) {
          emitPageUpdate(next, total)
        }
        return next
      })
    },
    [emitPageUpdate, presentationMode]
  )

  const handleNext = useCallback(
    (options?: { broadcast?: boolean }) => {
      goToPage((prevPage) => prevPage + 1, options)
    },
    [goToPage]
  )

  const handlePrev = useCallback(
    (options?: { broadcast?: boolean }) => {
      goToPage((prevPage) => prevPage - 1, options)
    },
    [goToPage]
  )

  const handleDocumentLoad = useCallback(
    (numPages: number) => {
      setTotalPages(numPages)
      setCurrentPage((prevPage) => {
        const next = Math.min(prevPage, numPages)
        if (presentationMode) {
          emitPageUpdate(next, numPages)
        }
        return next
      })
    },
    [emitPageUpdate, presentationMode]
  )

  const exitPresentation = useCallback(() => {
    setPresentationMode(false)
    presenterWindowRef.current?.close()
    presenterWindowRef.current = null
    stopCamera()
    emitEndSession()
  }, [emitEndSession, stopCamera])

  const deletePdf = () => {
    if (presentationMode) {
      exitPresentation()
    }
    setPdfFile(null)
    setCurrentPage(1)
    setTotalPages(1)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const startPresentation = () => {
    if (!pdfFile) {
      alert('Please upload a PDF before continuing.')
      return
    }
    const presenterUrl = `${window.location.origin}/presenter`
    const presenterWindow = window.open(
      presenterUrl,
      'PresenterWindow',
      'width=1600,height=900,resizable=yes'
    )
    if (!presenterWindow) {
      alert('Please enable pop-ups to open the presenter view.')
      return
    }
    presenterWindowRef.current = presenterWindow
    setPresentationMode(true)
  }

  useEffect(() => {
    if (!pdfFile) {
      setPdfUrl(null)
      setCurrentPage(1)
      setTotalPages(1)
      return
    }
    const objectUrl = URL.createObjectURL(pdfFile)
    setPdfUrl(objectUrl)
    setCurrentPage(1)
    setTotalPages(1)
    return () => {
      URL.revokeObjectURL(objectUrl)
    }
  }, [pdfFile])

  useEffect(() => {
    latestStateRef.current = {
      currentPage,
      totalPages,
      pdfUrl,
    }
  }, [currentPage, totalPages, pdfUrl])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }
    const channel = new BroadcastChannel(CHANNEL_NAME)
    channelRef.current = channel

    const handleMessage = (event: MessageEvent<PresentationMessage>) => {
      const data = event.data
      if (!data || data.senderId === windowId) {
        return
      }
      switch (data.type) {
        case 'REQUEST_STATE': {
          if (latestStateRef.current.pdfUrl) {
            channel.postMessage({
              type: 'FILE_URL',
              url: latestStateRef.current.pdfUrl,
              senderId: windowId,
            })
          }
          channel.postMessage({
            type: 'PAGE_UPDATE',
            page: latestStateRef.current.currentPage,
            totalPages: latestStateRef.current.totalPages,
            senderId: windowId,
          })
          break
        }
        case 'PAGE_UPDATE':
          if (typeof data.page === 'number') {
            setCurrentPage(data.page)
          }
          if (typeof data.totalPages === 'number') {
            setTotalPages(data.totalPages)
          }
          break
        case 'END_SESSION':
          setPresentationMode(false)
          presenterWindowRef.current?.close()
          presenterWindowRef.current = null
          break
        default:
          break
      }
    }

    channel.addEventListener('message', handleMessage)
    return () => {
      channel.removeEventListener('message', handleMessage)
      channel.close()
    }
  }, [windowId])

  useEffect(() => {
    if (!presentationMode) {
      return
    }
    if (pdfUrl) {
      emitFileUrl()
    }
    emitPageUpdate(
      latestStateRef.current.currentPage,
      latestStateRef.current.totalPages
    )
  }, [presentationMode, pdfUrl, emitFileUrl, emitPageUpdate])

  // Keyboard nav in main page
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (!presentationMode) {
        if (e.key === 'ArrowLeft') prev()
        else if (e.key === 'ArrowRight') next()
      } else {
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === ' ') {
          e.preventDefault()
          handleNext()
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
          e.preventDefault()
          handlePrev()
        }
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [presentationMode, next, prev, handleNext, handlePrev])

  // Turn camera on/off depending on slide
  useEffect(() => {
    if (index === 2 && !presentationMode) setCameraActive(true)
    else setCameraActive(false)
  }, [index, presentationMode])

  // Camera stream effect
  useEffect(() => {
    if (!cameraActive) {
      stopCamera()
      return
    }

    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        cameraStreamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          videoRef.current.play()
        }
      })
      .catch(() => alert('Unable to access camera.'))

    return () => {
      stopCamera()
    }
  }, [cameraActive, stopCamera])

  return (
    <main className="w-full h-screen flex flex-col bg-background relative">
      {presentationMode ? (
        <section className="relative w-full h-full bg-secondary-foreground text-background">
          <div className="absolute top-4 right-4 z-10">
            <button
              className="px-4 py-2 bg-destructive text-background rounded cursor-pointer hover:opacity-90 transition "
              onClick={exitPresentation}
            >
              Exit Presentation
            </button>
          </div>
          <div
            className="w-full h-full flex items-center justify-center px-6 cursor-pointer"
            onClick={() => handleNext()}
          >
            <div className="w-full h-full max-w-6xl">
              <PDFViewer
                file={pdfUrl}
                pageNumber={currentPage}
                scrollable={false}
                onDocumentLoad={handleDocumentLoad}
              />
            </div>
          </div>
        </section>
      ) : (
        <section className="w-full flex-1 relative overflow-hidden">
          <div
            className="flex transition-transform duration-300 ease-out h-full"
            style={{
              width: `${slideCount * 100}%`,
              transform: `translateX(-${(index * 100) / slideCount}%)`,
            }}
          >
            {SLIDES.map((s) => (
              <article
                key={s.id}
                className="shrink-0 w-screen h-full flex flex-col justify-center items-center px-6"
              >
                <h2 className="text-3xl sm:text-5xl font-semibold mb-6 text-center">
                  {s.title}
                </h2>
                <p className="text-lg sm:text-xl text-center">{s.body}</p>

                {/* PDF Upload Slide */}
                {s.id === 1 && (
                  <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-2xl mx-auto">
                    {!pdfFile ? (
                      <label className="flex flex-col items-center justify-center w-full h-72 border-4 border-dashed rounded-lg cursor-pointer hover:border-blue-500">
                        <span>Click to upload a PDF</span>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="application/pdf"
                          className="hidden"
                          onChange={(e) =>
                            setPdfFile(e.target.files?.[0] ?? null)
                          }
                        />
                      </label>
                    ) : (
                      <>
                        <div className="relative w-full rounded flex justify-center items-center">
                          <div className="w-full h-[400px]">
                            <PDFViewer
                              file={pdfUrl}
                              pageNumber={currentPage}
                              scrollable={false}
                              onDocumentLoad={handleDocumentLoad}
                            />
                          </div>
                          <button
                            onClick={deletePdf}
                            className="absolute top-2 right-2 bg-destructive text-background px-2 py-1 rounded cursor-pointer hover:opacity-90 transition "
                          >
                            Remove PDF
                          </button>
                        </div>
                        <div className="flex gap-4 mt-4">
                          <button
                            onClick={() => handlePrev({ broadcast: false })}
                            className="px-4 py-2 bg-primary text-background rounded cursor-pointer hover:bg-primary-hover transition"
                          >
                            Previous Page
                          </button>
                          <button
                            onClick={() => handleNext({ broadcast: false })}
                            className="px-4 py-2 bg-primary text-background rounded cusor-pointer hover:bg-primary-hover transition"
                          >
                            Next Page
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* Gesture Slide */}
                {s.id === 2 && (
                  <div className="mt-10 flex flex-col items-center gap-6">
                    <div className="w-full max-w-md h-80 bg-black rounded-lg overflow-hidden border shadow flex items-center justify-center">
                      <video
                        ref={videoRef}
                        className="w-full h-full object-contain"
                        autoPlay
                        playsInline
                      />
                    </div>
                    <p className="text-center text-sm text-gray-500">
                      Make sure your hands are visible and well lit.
                    </p>
                    <p className="text-center text-lg font-medium mt-4">
                      Can we use your gestures to train our model to be more
                      accurate?
                    </p>
                    <div className="flex gap-6 mt-2">
                      <button
                        className="px-6 py-2 rounded-lg bg-primary text-white font-semibold cursor-pointer hover:bg-primary-hover transition"
                        onClick={() => {
                          //alert('Thanks for agreeing! Proceeding to next step.')
                          next()
                        }}
                      >
                        Yes
                      </button>

                      <button
                        className="px-6 py-2 rounded-lg bg-primary text-white font-semibold cursor-pointer hover:bg-primary-hover transition"
                        onClick={() => {
                          //alert('No problem! Proceeding to next step.')
                          next()
                        }}
                      >
                        No
                      </button>
                    </div>
                    <button
                      className="mt-4 text-sm underline text-gray-500 cursor-pointer hover:text-gray-700"
                      onClick={next}
                    >
                      Skip
                    </button>
                  </div>
                )}

                {/* Begin Presentation Slide */}
                {s.id === 3 && (
                  // <button onClick={startPresentation}>Begin</button>

                  <button
                        className=" px-6 py-2 rounded-lg bg-primary text-white font-semibold cursor-pointer hover:bg-primary-hover transition"//cursor:pointer"
                        onClick={startPresentation}
                      >
                        Begin
                      </button>
                )}
              </article>
            ))}
          </div>

          {/* Arrows */}
          {/* Previous Button */}
          <button
            aria-label="Previous step"
            onClick={prev}
            className="group absolute z-50 top-1/2 left-3 -translate-y-1/2 hidden sm:flex items-center justify-center 
                        rounded-full w-10 h-10 border bg-tertiary/50 border-tertiary/60
                        hover:bg-blue-500 transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-5 h-5 text-secondary-foreground group-hover:text-white transition-colors cursor:pointer" />
          </button>

          {/* Next Button */}
          <button
            aria-label="Next step"
            onClick={next}
            disabled={index === 1 && !pdfFile} // disable if no PDF on slide 1
            className={`group absolute z-50 top-1/2 right-3 -translate-y-1/2 hidden sm:flex items-center justify-center 
                        rounded-full w-10 h-10 border transition-colors
                        ${
                          index === 1 && !pdfFile
                            ? 'bg-gray-200 cursor-not-allowed opacity-50 border-gray-300'
                            : 'bg-tertiary/50 border-tertiary/60 hover:bg-blue-500 hover:text-white cursor:pointer'
                        }`}
          >
            <ChevronRight className="w-5 h-5 text-secondary-foreground group-hover:text-white transition-colors" />
          </button>

          {/* Dots */}
          <div className="absolute bottom-6 left-0 w-full flex flex-col sm:flex-row items-center justify-center gap-4 px-6">
            <div className="flex items-center gap-2">
              {SLIDES.map((_, i) => {
                const isActive = i === index
                const isBlocked = dotDisabled(i)
                return (
                  <button
                    key={i}
                    aria-label={`Step ${i + 1} of ${slideCount}`}
                    aria-current={isActive ? 'true' : 'false'}
                    onClick={() => !isBlocked && goTo(i)}
                    disabled={isBlocked}
                    className={`rounded-full transition-all duration-300 ${
                      isBlocked
                        ? 'w-2 h-2 bg-gray-300 cursor-not-allowed'
                        : isActive
                        ? 'w-3 h-3 bg-gray-700'
                        : 'w-2 h-2 bg-gray-400 hover:bg-gray-500 cursor-pointer'
                    }`}
                  />
                )
              })}
            </div>
          </div>
        </section>
      )}
    </main>
  )
}

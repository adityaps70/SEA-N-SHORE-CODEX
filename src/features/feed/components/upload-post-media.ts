export function uploadPostMediaFile(input: {
  uploadUrl: string
  file: File
  onProgress: (percent: number) => void
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    const fail = () => reject(new Error('media_upload_failed'))

    xhr.open('PUT', input.uploadUrl)
    xhr.setRequestHeader('Content-Type', input.file.type)
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || event.total <= 0) return
      const percent = Math.max(0, Math.min(100, Math.round((event.loaded / event.total) * 100)))
      input.onProgress(percent)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        input.onProgress(100)
        resolve()
        return
      }
      fail()
    }
    xhr.onerror = fail
    xhr.onabort = fail
    xhr.send(input.file)
  })
}

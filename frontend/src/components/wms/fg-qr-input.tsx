import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { isValidUpload } from "@/lib/input-validation";
import { toast } from "sonner";

export function FgQrInput({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const [camera, setCamera] = useState(false);
  useEffect(() => {
    if (!camera || disabled) return;
    let cancelled = false;
    let stream: MediaStream | undefined;
    let timer: number | undefined;
    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        if (!video.current) return;
        video.current.srcObject = stream;
        await video.current.play();
        timer = window.setInterval(() => {
          const source = video.current;
          if (!source?.videoWidth) return;
          const canvas = document.createElement("canvas");
          canvas.width = source.videoWidth;
          canvas.height = source.videoHeight;
          const context = canvas.getContext("2d");
          if (!context) return;
          context.drawImage(source, 0, 0);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const decoded = jsQR(image.data, image.width, image.height);
          if (decoded) {
            onChange(decoded.data);
            setCamera(false);
          }
        }, 400);
      } catch {
        if (!cancelled) {
          toast.error("Unable to access camera");
          setCamera(false);
        }
      }
    })();
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [camera, disabled, onChange]);
  const upload = async (image: File) => {
    if (!isValidUpload(image, ["image/png", "image/jpeg"])) {
      toast.error("Upload a PNG or JPEG image up to 5 MB.");
      return;
    }
    try {
      const bitmap = await createImageBitmap(image);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Image decoding unavailable");
        context.drawImage(bitmap, 0, 0);
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
        const qr = jsQR(pixels.data, pixels.width, pixels.height);
        if (!qr) throw new Error("No QR code found in image");
        onChange(qr.data);
      } finally {
        bitmap.close();
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to decode QR image");
    }
  };
  return (
    <div className="space-y-2">
      <label htmlFor="fg-dispatch-qr" className="text-xs font-semibold">
        Finished goods / package QR
      </label>
      <div className="flex flex-wrap gap-2">
        <Input
          id="fg-dispatch-qr"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          placeholder="Scan or enter QR"
          className="min-w-0 flex-1 rounded-xl text-xs sm:min-w-64"
        />
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={disabled}
          onClick={() => file.current?.click()}
        >
          Upload QR
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="rounded-xl"
          disabled={disabled}
          onClick={() => setCamera(!camera)}
        >
          {camera ? "Stop camera" : "Scan Camera"}
        </Button>
        <input
          ref={file}
          type="file"
          accept="image/png,image/jpeg"
          className="hidden"
          aria-label="Upload QR image"
          onChange={(event) => {
            const image = event.target.files?.[0];
            if (image) void upload(image);
            event.currentTarget.value = "";
          }}
        />
      </div>
      {camera && (
        <video ref={video} muted playsInline className="max-h-60 w-full rounded-xl bg-black" />
      )}
    </div>
  );
}

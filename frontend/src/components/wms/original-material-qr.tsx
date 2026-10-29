import { useEffect, useState } from "react";
import type {
  AssemblyFinishedGoodsTraceability,
  AssemblyFinishedGoodsTraceabilityMaterial as Material,
} from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  downloadOriginalMaterialQr,
  hasOriginalMaterialQr,
  ORIGINAL_QR_UNAVAILABLE,
  originalQrPrintSet,
  printOriginalMaterialQrs,
  renderOriginalMaterialQr,
} from "@/lib/original-material-qr";

export function PrintAllMaterialQrs({ data }: { data: AssemblyFinishedGoodsTraceability }) {
  const { materials, warning } = originalQrPrintSet(data);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="space-y-2">
      <Button
        variant="outline"
        size="sm"
        disabled={busy || !materials.length}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            await printOriginalMaterialQrs(materials, warning);
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing labels..." : "Print All Material QRs"}
      </Button>
      {warning && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          {warning}
        </p>
      )}
      {!materials.length && (
        <p className="text-xs text-muted-foreground">
          No verified original material QRs are available to print.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-rose-700">
          {error}
        </p>
      )}
    </div>
  );
}

export function OriginalMaterialQrPreview({
  material,
  onClose,
}: {
  material: Material;
  onClose: () => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const available = hasOriginalMaterialQr(material);
  useEffect(() => {
    let active = true;
    setUrl(null);
    setError(null);
    if (available)
      void renderOriginalMaterialQr(material)
        .then((image) => {
          if (active) setUrl(image);
        })
        .catch(() => {
          if (active)
            setError(
              "Unable to render the original material QR. The stored payload may be invalid or too large.",
            );
        });
    return () => {
      active = false;
    };
  }, [material, available]);
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] overflow-auto rounded-2xl bg-white sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Original Material QR</DialogTitle>
          <DialogDescription>
            This QR originated from the GRN batch. Its original encoded content is unchanged.
          </DialogDescription>
        </DialogHeader>
        <dl className="grid grid-cols-2 gap-3 rounded-xl border border-border/70 p-4 text-xs">
          {[
            ["Material Name", material.material_name],
            ["Material Code", material.material_code],
            ["Original GRN Batch Number", material.batch_number],
            ["GRN Reference", material.grn_reference.grn_number || material.grn_reference.grn_id],
            [
              "Quantity Consumed",
              material.quantity_consumed.toLocaleString(undefined, { maximumFractionDigits: 20 }),
            ],
            ["Unit of Measurement", material.uom],
            ["Original QR Identity", material.original_qr_identity],
          ].map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words font-medium">{value || "Unavailable"}</dd>
            </div>
          ))}
        </dl>
        {!available ? (
          <p role="alert" className="text-sm text-slate-700">
            {ORIGINAL_QR_UNAVAILABLE}
          </p>
        ) : url ? (
          <img
            src={url}
            alt={`Original material QR for ${material.material_code} batch ${material.batch_number}`}
            className="mx-auto h-auto w-full max-w-[280px] bg-white"
            onError={() => {
              setUrl(null);
              setError("Unable to display the original material QR. Close and try again.");
            }}
          />
        ) : (
          !error && (
            <p role="status" className="py-6 text-center text-sm text-muted-foreground">
              Loading original material QR...
            </p>
          )
        )}
        {error && (
          <p role="alert" className="text-sm text-rose-700">
            {error}
          </p>
        )}
        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="outline"
            disabled={!url || busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await printOriginalMaterialQrs([material]);
              } catch (error) {
                setError((error as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Print QR
          </Button>
          <Button
            disabled={!url || busy}
            onClick={() => {
              setError(null);
              try {
                downloadOriginalMaterialQr(material, url!);
              } catch {
                setError("Unable to download the original material QR. Please try again.");
              }
            }}
          >
            Download QR
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

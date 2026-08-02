"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { toast, ToastContainer } from "@/components/ui/Toast";
import { leaveCircle } from "./actions";

interface LeaveCircleButtonProps {
  circleId: string;
  circleName: string;
}

export function LeaveCircleButton({ circleId, circleName }: LeaveCircleButtonProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  async function handleLeave() {
    setIsLoading(true);
    try {
      await leaveCircle(circleId);
      toast.success(`Left "${circleName}".`);
      setIsOpen(false);
      router.push("/circles");
      router.refresh();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to leave circle."
      );
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <>
      <ToastContainer />
      <Button
        variant="secondary"
        size="sm"
        data-testid="leave-circle-open"
        onClick={() => setIsOpen(true)}
      >
        <LogOut size={14} strokeWidth={2.5} />
        Leave
      </Button>

      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Leave this circle?">
        <div className="space-y-4">
          <p className="text-sm" style={{ color: "var(--color-ink-secondary)" }}>
            You&apos;ll lose access to {circleName} and anything only its members can
            see. You can rejoin with an invite code.
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => setIsOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="danger"
              size="md"
              className="flex-1"
              data-testid="leave-circle-confirm"
              isLoading={isLoading}
              onClick={handleLeave}
            >
              Leave Circle
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

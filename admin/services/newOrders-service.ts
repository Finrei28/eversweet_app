import { Order, QueuedOrder } from "@/lib/types"
import EventEmitter from "eventemitter3"

class newOrdersManager {
  // To show new orders on screen
  private queue: QueuedOrder[] = []
  private isShowingAlert = false
  private currentOrder: Order | null = null
  private currentResolver: ((value: void) => void) | null = null
  private eventEmitter = new EventEmitter()

  getCurrentOrder() {
    return this.currentOrder
  }

  getQueueLength() {
    return this.queue.length
  }

  subscribe(callback: (order: Order | null) => void) {
    callback(this.currentOrder)
    this.eventEmitter.on("orderChanged", callback)

    return () => {
      this.eventEmitter.off("orderChanged", callback)
    }
  }

  enqueue(newOrderJob: QueuedOrder) {
    const alreadyQueued = this.queue.some(
      (queuedOrder) => queuedOrder.id === newOrderJob.id,
    )

    if (!alreadyQueued) {
      this.queue.push(newOrderJob)
    }

    this.processQueue()
  }

  private async processQueue() {
    if (this.isShowingAlert) {
      return
    }

    this.isShowingAlert = true

    try {
      while (this.queue.length > 0) {
        const queuedJob = this.queue.shift()

        if (!queuedJob) continue

        try {
          await this.alertNewOrder(queuedJob.order)
        } catch (error) {
          console.error(`Failed to queue order ${queuedJob.id}`, error)
          this.queue.unshift(queuedJob)
          break

          // Keep the job in AsyncStorage so it can be retried later
        }
      }
    } finally {
      this.isShowingAlert = false
    }
  }

  private async alertNewOrder(order: Order) {
    this.currentOrder = order

    this.eventEmitter.emit("orderChanged", this.currentOrder)

    return new Promise<void>((resolve) => {
      this.currentResolver = resolve
    })
  }

  resolveCurrentAlert() {
    this.currentOrder = null

    this.eventEmitter.emit("orderChanged", null)

    this.currentResolver?.()
    this.currentResolver = null
  }
}

const newOrderServices = new newOrdersManager()
export default newOrderServices

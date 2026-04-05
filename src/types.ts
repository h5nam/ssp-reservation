export interface LoginResult {
  success: boolean;
  message: string;
}

export interface RoomSlot {
  spaceNo: string;
  spaceName: string;
  time: string;
  status: "available" | "booked" | "impossible";
  bookedBy?: string;
}

export interface RoomAvailability {
  date: string;
  rooms: {
    spaceNo: string;
    spaceName: string;
    slots: RoomSlot[];
  }[];
}

export interface BookingResult {
  success: boolean;
  message: string;
  reservationId?: string;
}

export interface Reservation {
  id: string;
  spaceName: string;
  date: string;
  startTime: string;
  endTime: string;
  participants: number;
  description: string;
  status: string;
}

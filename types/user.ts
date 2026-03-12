export type UserStatus = "online" | "offline";

export type CollaboratorIdentity = {
  id: string;
  name: string;
  color: string;
};

export type UserModel = CollaboratorIdentity & {
  clientId: number;
  status: UserStatus;
  isCurrentUser: boolean;
  isTyping: boolean;
};

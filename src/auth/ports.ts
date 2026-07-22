export interface AuthUser {
  uid: string;
  displayName: string | null;
  email: string | null;
  photoURL: string | null;
}

export interface AuthPort {
  observe(listener: (user: AuthUser | null) => void, onError: (error: Error) => void): () => void;
  signInWithGoogle(): Promise<void>;
  signOut(): Promise<void>;
}

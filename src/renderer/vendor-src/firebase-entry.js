// Wejście do paczki Firebase (budowane do src/renderer/vendor/firebase.js poleceniem `npm run vendor`).
export { initializeApp } from 'firebase/app';
export { getAuth, signInWithCustomToken, signOut } from 'firebase/auth';
export {
  initializeFirestore, persistentLocalCache, persistentSingleTabManager,
  doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch, runTransaction, serverTimestamp, deleteField,
} from 'firebase/firestore';

// public/js/socket.js
// Ensure you load socket.io client script; then:
export function connectSocket() {
  // Same-origin: just call io() with credentials
  const socket = io('/', { withCredentials: true });

  socket.on('connect', () => {
    console.log('Socket connected', socket.id);
  });

  socket.on('disconnect', (reason) => {
    console.warn('Socket disconnected', reason);
  });

  socket.on('connect_error', (err) => {
    console.error('Socket connect_error', err?.message);
  });

  return socket;
}

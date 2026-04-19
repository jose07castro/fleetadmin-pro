let intervalId = null;

self.onmessage = function (e) {
    if (e.data === 'start') {
        if (!intervalId) {
            // Ping the main thread every 2 seconds.
            // Para forzar la evaluación agresiva (3.5s normal o 10s ecosistema).
            intervalId = setInterval(() => {
                self.postMessage('ping');
            }, 2000);
        }
    } else if (e.data === 'stop') {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }
};

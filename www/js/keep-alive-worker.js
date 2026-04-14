let intervalId = null;

self.onmessage = function (e) {
    if (e.data === 'start') {
        if (!intervalId) {
            // Ping the main thread every 5 seconds.
            // Web Workers don't suffer from the same severe background throttling 
            // as the main browser thread (which slows to 1 per minute or fully stops).
            intervalId = setInterval(() => {
                self.postMessage('ping');
            }, 5000);
        }
    } else if (e.data === 'stop') {
        if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
        }
    }
};

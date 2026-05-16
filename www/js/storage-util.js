/* ============================================
   Punto Alertas — Storage & Image Utility
   Manejo eficiente de imágenes (resizing + base64)
   ============================================ */

const StorageUtil = (() => {

    /**
     * Comprime y redimensiona una imagen para optimizar el almacenamiento.
     * @param {File} file Objeto File de un input type="file"
     * @param {number} maxWidth Ancho máximo (default 1024)
     * @param {number} maxHeight Alto máximo (default 1024)
     * @param {number} quality Calidad JPEG (0 a 1)
     */
    async function compressImage(file, maxWidth = 1024, maxHeight = 1024, quality = 0.8) {
        if (!file) return null;

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
                const img = new Image();
                img.src = event.target.result;
                img.onload = () => {
                    const canvas = document.createElement('canvas');
                    let width = img.width;
                    let height = img.height;

                    if (width > height) {
                        if (width > maxWidth) {
                            height *= maxWidth / width;
                            width = maxWidth;
                        }
                    } else {
                        if (height > maxHeight) {
                            width *= maxHeight / height;
                            height = maxHeight;
                        }
                    }

                    canvas.width = width;
                    canvas.height = height;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, width, height);
                    resolve(canvas.toDataURL('image/jpeg', quality));
                };
                img.onerror = reject;
            };
            reader.onerror = reject;
        });
    }

    /**
     * Convierte un File a Base64 sin redimensionar.
     */
    function fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result);
            reader.onerror = error => reject(error);
        });
    }

    return {
        compressImage,
        fileToBase64
    };

})();

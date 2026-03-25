/* ============================================
   FleetAdmin Pro — Módulo de Candidatos
   Reclutamiento de nuevos conductores
   ============================================ */

const ApplicantsModule = (() => {

    // Coordenada Base: Rosario, Argentina
    const BASE_LAT = -32.9468;
    const BASE_LNG = -60.6393;
    const MAX_DISTANCE_KM = 25;

    // --- Helper: Fórmula de Haversine ---
    function getDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radio de la Tierra en km
        const dLat = (trueLat2 - lat1) * Math.PI / 180;
        const dLon = (trueLon2 - lon1) * Math.PI / 180;
        const a = 
            Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(trueLat2 * Math.PI / 180) * 
            Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return R * c; 
    }

    // Workaround manual calc para arreglar el scoping
    function calculateDistance(lat, lng) {
        const R = 6371;
        const dLat = (lat - BASE_LAT) * Math.PI / 180;
        const dLon = (lng - BASE_LNG) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(BASE_LAT * Math.PI / 180) * Math.cos(lat * Math.PI / 180) * 
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
        return R * c;
    }

    // ==========================================
    // VISTA PÚBLICA: Postulación
    // ==========================================
    function renderApply() {
        return `
            <div class="login-screen" style="flex-direction:column; padding: var(--space-4); align-items:center;">
                <div style="width:100%; max-width:500px; background:var(--bg-secondary); border-radius:var(--radius-xl); padding:var(--space-6); box-shadow:var(--shadow-lg); text-align:center;">
                    
                    <div style="font-size:3rem; margin-bottom:var(--space-2);">🚗</div>
                    <h2 style="font-size:1.5rem; margin-bottom:var(--space-4);">Postularme para Conductor</h2>
                    
                    <div id="geoBlocker" style="display:block;">
                        <p style="color:var(--text-secondary); margin-bottom:var(--space-4);">
                            Estamos comprobando si te encontrás dentro de nuestra área de cobertura...
                        </p>
                        <button class="btn btn-primary" onclick="ApplicantsModule.checkLocation()">
                            📍 Verificar Ubicación
                        </button>
                    </div>

                    <div id="errorBlocker" style="display:none; color:var(--color-danger); padding:var(--space-4); background:rgba(239, 68, 68, 0.1); border-radius:var(--radius-lg); margin-top:var(--space-4);">
                        <h3 style="margin-bottom:10px;">Fuera de Cobertura</h3>
                        <p>Por el momento solo operamos en un radio de 25km de la ciudad principal.</p>
                        <button class="btn btn-secondary" style="margin-top:var(--space-4);" onclick="Router.navigate('login')">Volver al Inicio</button>
                    </div>

                    <div id="applyForm" style="display:none; text-align:left;">
                        <div class="form-group">
                            <label class="form-label">Nombre y Apellido *</label>
                            <input type="text" class="form-input" id="appNombre" placeholder="Ej: Juan Pérez">
                        </div>
                        
                        <div class="form-group">
                            <label class="form-label">Fecha de Nacimiento *</label>
                            <input type="date" class="form-input" id="appFechaNac">
                            <div style="font-size:0.75rem; color:var(--text-secondary); margin-top:5px;">Debes ser mayor de 18 años.</div>
                        </div>

                        <div class="form-group">
                            <label class="form-label">DNI *</label>
                            <input type="number" class="form-input" id="appDni" placeholder="Ej: 35000000">
                        </div>

                        <div class="form-group">
                            <label class="form-label">Dirección y Ciudad *</label>
                            <input type="text" class="form-input" id="appDireccion" placeholder="Ej: San Martín 123, Rosario">
                        </div>

                        <div class="form-group">
                            <label class="form-label">Tipo de Licencia *</label>
                            <select class="form-select" id="appTipoLicencia">
                                <option value="">Seleccione una opción</option>
                                <option value="B1">B1 (Auto particular)</option>
                                <option value="D1">D1 (Transporte de Pasajeros)</option>
                                <option value="D2">D2 (Transporte Profesional)</option>
                            </select>
                        </div>

                        ${Components.renderPhotoCapture('appLicencia', 'Foto de Licencia de Conducir *')}

                        <button class="btn btn-primary w-full" id="btnSubmitApply" style="margin-top:var(--space-6); width:100%; padding:0.8rem; font-size:1.1rem;" onclick="ApplicantsModule.submitApply()">
                            🚀 Enviar Postulación
                        </button>
                        
                        <div style="text-align:center; margin-top:var(--space-4);">
                            <a href="#" style="color:var(--color-primary);" onclick="Router.navigate('login')">Cancelar y Volver</a>
                        </div>
                    </div>
                    
                </div>
            </div>
        `;
    }

    function checkLocation() {
        if (!navigator.geolocation) {
            Components.showToast('Tu navegador no soporta geolocalización', 'danger');
            return;
        }

        Components.showToast('Obteniendo ubicación...', 'info');

        navigator.geolocation.getCurrentPosition((position) => {
            const lat = position.coords.latitude;
            const lng = position.coords.longitude;
            
            const dist = calculateDistance(lat, lng);
            console.log(\`📍 Distancia a Base: \${dist.toFixed(2)} km\`);
            
            document.getElementById('geoBlocker').style.display = 'none';

            if (dist <= MAX_DISTANCE_KM) {
                // OK, dentro del área
                document.getElementById('applyForm').style.display = 'block';
                Components.showToast('¡Estás dentro de nuestra área! Completa el formulario.', 'success');
            } else {
                // Fuera del área
                document.getElementById('errorBlocker').style.display = 'block';
            }
        }, (error) => {
            console.error('Error de Geolocalización:', error);
            Components.showToast('No pudimos acceder a tu ubicación. Asegurate de dar permisos.', 'danger');
        });
    }

    async function submitApply() {
        const nombre = document.getElementById('appNombre')?.value.trim();
        const fechaNac = document.getElementById('appFechaNac')?.value;
        const dni = document.getElementById('appDni')?.value.trim();
        const direccion = document.getElementById('appDireccion')?.value.trim();
        const tipoLicencia = document.getElementById('appTipoLicencia')?.value;
        const btn = document.getElementById('btnSubmitApply');
        const photoData = Components.getPhotoData('appLicencia');

        if (!nombre || !fechaNac || !dni || !direccion || !tipoLicencia) {
            Components.showToast('Por favor completá todos los campos Obligatorios', 'danger');
            return;
        }

        if (!photoData) {
            Components.showToast('Debes adjuntar la foto de tu licencia', 'danger');
            return;
        }

        // Validar mayoría de edad (18 años)
        const birthDate = new Date(fechaNac);
        const today = new Date();
        let age = today.getFullYear() - birthDate.getFullYear();
        const m = today.getMonth() - birthDate.getMonth();
        if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
            age--;
        }

        if (age < 18) {
            Components.showToast('Debes ser mayor de 18 años para postularte', 'danger');
            return;
        }

        try {
            btn.disabled = true;
            btn.innerHTML = '⏳ Subiendo documentos...';

            let photoUrl = '';
            // Subir usando un hash temporal para el nombre en Storage
            const tempId = Date.now() + Math.random().toString(36).substr(2, 5);
            const path = \`licencias_postulantes/\${tempId}.jpg\`;
            
            photoUrl = await StorageUtil.uploadImage(photoData, path);

            btn.innerHTML = '⏳ Procesando Postulación...';

            const applicantData = {
                nombre,
                fechaNac,
                edad: age,
                dni,
                direccion,
                tipoLicencia,
                photoUrl,
                status: 'pending'
            };

            await DB.addApplicant(applicantData);

            Components.showModal('✅ ¡Postulación Enviada!', 
                '<p>Hemos recibido tus datos correctamente. Nuestro equipo los revisará y se pondrá en contacto pronto.</p>',
                \`<button class="btn btn-primary" onclick="Components.closeModal(); Router.navigate('login')">Aceptar</button>\`,
                { staticBackdrop: true, onClose: () => Router.navigate('login') }
            );

        } catch (error) {
            console.error('Error al enviar postulación:', error);
            Components.showToast('Ocurrió un error guardando tu postulación.', 'danger');
        } finally {
            if(btn) {
                btn.disabled = false;
                btn.innerHTML = '🚀 Enviar Postulación';
            }
        }
    }

    // ==========================================
    // VISTA DUEÑO: Panel Administrativo de Candidatos
    // ==========================================
    async function renderAdmin() {
        const applicants = await DB.getApplicants();

        return \`
            <div class="mechanic-header">
                <div>
                    <h2 style="font-size:var(--font-size-2xl); font-weight:700;">📝 Candidatos a Conductor</h2>
                    <p style="color:var(--text-secondary); margin-top:5px;">Postulaciones recibidas en el radio operativo global.</p>
                </div>
            </div>

            \${applicants.length > 0 ? \`
                <div class="vehicle-cards" style="margin-top:var(--space-6);">
                    \${applicants.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).map(a => renderApplicantCard(a)).join('')}
                </div>
            \` : Components.renderEmptyState(
                '📝',
                'No hay candidatos aún',
                'Las postulaciones aparecerán aquí automáticamente.'
            )}
        \`;
    }

    function renderApplicantCard(app) {
        const dateStr = new Date(app.createdAt).toLocaleDateString();
        
        return \`
            <div class="vehicle-card">
                <div class="vehicle-card-header">
                    <span class="vehicle-name">👤 \${Components.escapeHTML(app.nombre)}</span>
                    <span class="badge" style="background:var(--bg-tertiary);">\${dateStr}</span>
                </div>
                
                <div class="vehicle-stats" style="margin-top:var(--space-3); margin-bottom:var(--space-4);">
                    <div class="vehicle-stat">
                        <div class="vehicle-stat-value">\${app.edad} años</div>
                        <div class="vehicle-stat-label">Edad</div>
                    </div>
                    <div class="vehicle-stat">
                        <div class="vehicle-stat-value">\${Components.escapeHTML(app.tipoLicencia)}</div>
                        <div class="vehicle-stat-label">Licencia</div>
                    </div>
                </div>

                <div style="font-size:0.85rem; color:var(--text-secondary); margin-bottom:var(--space-4);">
                    <p style="margin-bottom:4px;"><strong>DNI:</strong> \${Components.escapeHTML(app.dni)}</p>
                    <p><strong>Ubicación:</strong> \${Components.escapeHTML(app.direccion)}</p>
                </div>

                <div style="display:flex; gap:var(--space-2);">
                    <button class="btn" style="flex:1; background:var(--bg-secondary); border:1px solid var(--border-color); color:var(--text-primary);" onclick="ApplicantsModule.viewLicense('\${app.photoUrl}')">
                        🖼️ Ver Licencia
                    </button>
                    <a href="https://wa.me/?text=Hola%20\${encodeURIComponent(app.nombre)}" target="_blank" class="btn" style="flex:1; background:#10b981; color:white; border:none; text-decoration:none; display:flex; justify-content:center; align-items:center;">
                        WhatsApp
                    </a>
                </div>
            </div>
        \`;
    }

    function viewLicense(photoUrl) {
        if (!photoUrl) {
            Components.showToast('El conductor no adjuntó o la imagen es corrupta.', 'danger');
            return;
        }
        Components.showModal('🖼️ Licencia de Conducir', \`
            <div style="text-align:center;">
                <img src="\${photoUrl}" style="max-width:100%; height:auto; border-radius:10px; margin-top:10px;">
            </div>
        \`, \`
            <button class="btn btn-secondary w-full" style="width:100%" onclick="Components.closeModal()">Cerrar Imagen</button>
        \`);
    }

    return { renderApply, renderAdmin, checkLocation, submitApply, viewLicense };
})();

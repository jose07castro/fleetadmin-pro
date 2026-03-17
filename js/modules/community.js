/* ============================================
   FleetAdmin Pro — Comunidad de Dueños
   Feed social para administradores de flota
   Datos globales en /community_posts/
   ============================================ */

const CommunityModule = (() => {

    // Mockup posts de prueba (se muestran si no hay posts reales)
    const MOCK_POSTS = [
        {
            id: 'mock1',
            author_name: 'Carlos M.',
            fleet_city: 'Buenos Aires',
            content: '¡Atención colegas! Hoy varios conductores reportaron controles de la CNRT en la autopista Dellepiane, altura Lanús. Lleven toda la documentación al día.',
            likes: 12, insights: 5,
            created_at: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mock2',
            author_name: 'Laura G.',
            fleet_city: 'Rosario',
            content: 'Consejo: Encontré un taller mecánico en zona sur que hace service completo para Cronos y Argo a muy buen precio. Si necesitan el contacto, escriban por acá. 🔧',
            likes: 8, insights: 14,
            created_at: new Date(Date.now() - 8 * 60 * 60 * 1000).toISOString()
        },
        {
            id: 'mock3',
            author_name: 'Martín R.',
            fleet_city: 'Córdoba',
            content: 'Pregunta para otros dueños: ¿Qué seguro están usando para la flota? La póliza de La Caja me subió un 40% este mes y estoy evaluando cambiar. Agradezco recomendaciones.',
            likes: 6, insights: 9,
            created_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
        }
    ];

    async function render() {
        const posts = await _getPosts();
        const userName = Auth.getUserName();
        const displayPosts = posts.length > 0 ? posts : MOCK_POSTS;
        const isMock = posts.length === 0;

        return `
        <div class="community-wall">
            <!-- Columna principal del feed (70%) -->
            <div class="community-main-col">
                <div class="community-header">
                    <div>
                        <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-1);">
                            💬 Comunidad de Dueños
                        </h2>
                        <p style="color:var(--text-secondary); font-size:var(--font-size-sm);">
                            Compartí experiencias, consejos y novedades con otros administradores de flota
                        </p>
                    </div>
                    <button class="btn btn-ghost" onclick="Router.navigate('dashboard')" style="flex-shrink:0;">
                        ← Volver al Panel
                    </button>
                </div>

                <!-- Caja de publicación -->
                <div class="community-compose card">
                    <div style="display:flex; gap:var(--space-3); align-items:flex-start;">
                        <div class="community-avatar">${(userName || 'U')[0].toUpperCase()}</div>
                        <div style="flex:1;">
                            <textarea id="communityPostText" class="form-input community-textarea"
                                placeholder="¿Qué información o alerta querés compartir con la comunidad?" rows="3"
                                maxlength="500"></textarea>
                            <div style="display:flex; justify-content:space-between; align-items:center; margin-top:var(--space-3);">
                                <span id="communityCharCount" style="font-size:var(--font-size-xs); color:var(--text-tertiary);">
                                    0 / 500
                                </span>
                                <button class="btn btn-primary community-publish-btn" onclick="CommunityModule.submitPost()">
                                    📤 Publicar
                                </button>
                            </div>
                        </div>
                    </div>
                </div>

                ${isMock ? `
                <div style="text-align:center; padding:var(--space-3) 0 var(--space-4); color:var(--text-tertiary); font-size:var(--font-size-xs); border-bottom:1px solid var(--border-color); margin-bottom:var(--space-4);">
                    ✨ Publicaciones de ejemplo — ¡Publicá la primera para reemplazarlas!
                </div>
                ` : ''}

                <!-- Feed -->
                <div class="community-feed" id="communityFeed">
                    ${displayPosts.map(p => _renderPost(p, isMock)).join('')}
                </div>
            </div>

            <!-- Columna de Sponsors (30%) -->
            <div class="community-sponsors-col">
                <div class="community-sponsor-card sponsor-ad-card">
                    <h4>🤝 Sponsors</h4>
                    <div class="sponsor-ad-image-wrapper">
                        <img src="assets/sponsor_leo_chevrolet.png" alt="LEO MECÁNICA — Chevrolet clásico rojo restaurado" class="sponsor-ad-image" />
                    </div>
                    <div class="sponsor-ad-info">
                        <h3 class="sponsor-ad-name">🔧 LEO MECÁNICA</h3>
                        <p class="sponsor-ad-location">📍 Dorrego 330, Villa Gobernador Gálvez</p>
                        <p class="sponsor-ad-phone">📞 Tel/WA: 3413650105</p>
                    </div>
                    <a href="https://wa.me/543413650105?text=Hola%20Leo,%20te%20contacto%20desde%20FleetAdmin%20Pro" target="_blank" rel="noopener noreferrer" class="sponsor-ad-cta">
                        💬 Contactar
                    </a>
                </div>
            </div>
        </div>
        `;
    }

    function _renderPost(post, isMock = false) {
        const date = new Date(post.created_at);
        const timeAgo = _timeAgo(date);
        const initial = (post.author_name || '?')[0].toUpperCase();

        return `
            <div class="community-post card">
                <div class="community-post-header">
                    <div class="community-avatar">${initial}</div>
                    <div style="flex:1;">
                        <div class="community-post-author">${post.author_name || 'Anónimo'}</div>
                        <div class="community-post-time">${timeAgo}</div>
                    </div>
                    ${post.fleet_city ? `
                        <span class="community-location-badge">
                            📍 ${post.fleet_city}
                        </span>
                    ` : ''}
                </div>
                <div class="community-post-body">${_escapeHTML(post.content)}</div>
                <div class="community-post-footer">
                    <button class="community-react-btn" ${isMock ? '' : `onclick="CommunityModule.reactToPost('${post.id}', '👍')"`}>
                        👍 ${post.likes || 0}
                    </button>
                    <button class="community-react-btn" ${isMock ? '' : `onclick="CommunityModule.reactToPost('${post.id}', '💡')"`}>
                        💡 ${post.insights || 0}
                    </button>
                    <button class="community-react-btn">
                        💬 Comentar
                    </button>
                </div>
            </div>
        `;
    }

    // --- Publicar un post ---
    async function submitPost() {
        const textarea = document.getElementById('communityPostText');
        const content = textarea?.value?.trim();

        if (!content || content.length < 3) {
            Components.showToast('⚠️ Escribí al menos 3 caracteres para publicar.', 'warning');
            return;
        }

        try {
            Components.showToast('📤 Publicando...', 'info');

            // Obtener ciudad de la flota para mostrar en el post
            let fleetCity = '';
            try {
                const location = await DB.getSetting('location');
                if (location && location.city) {
                    fleetCity = location.city;
                }
            } catch (e) { /* sin ubicación */ }

            const postData = {
                author_id: Auth.getUserId() || Auth.getUserName(),
                author_name: Auth.getUserName(),
                fleet_id: Auth.getFleetId(),
                fleet_city: fleetCity,
                content: content,
                likes: 0,
                insights: 0
            };

            await _addPost(postData);

            Components.showToast('✅ ¡Publicación enviada!', 'success');
            Router.navigate('community');
        } catch (error) {
            console.error('❌ Error publicando en comunidad:', error);
            Components.showToast('❌ Error al publicar: ' + (error.message || error), 'danger');
        }
    }

    // --- Reaccionar a un post ---
    async function reactToPost(postId, type) {
        try {
            const field = type === '👍' ? 'likes' : 'insights';
            const ref = firebaseDB.ref(`community_posts/${postId}/${field}`);
            await ref.transaction(current => (current || 0) + 1);
            // Refrescar
            Router.navigate('community');
        } catch (e) {
            console.warn('Error al reaccionar:', e);
        }
    }

    // --- afterRender: configurar contador de caracteres ---
    function afterRender() {
        // JS fallback: add class for left-alignment override (for browsers without :has())
        const appContent = document.querySelector('.app-content');
        if (appContent) appContent.classList.add('community-active');

        const textarea = document.getElementById('communityPostText');
        const counter = document.getElementById('communityCharCount');
        if (textarea && counter) {
            textarea.addEventListener('input', () => {
                counter.textContent = `${textarea.value.length} / 500`;
            });
        }
    }

    // --- Helpers de Firebase ---
    async function _addPost(data) {
        const ref = firebaseDB.ref('community_posts').push();
        const post = {
            ...data,
            id: ref.key,
            created_at: new Date().toISOString()
        };
        await ref.set(post);
        return ref.key;
    }

    async function _getPosts() {
        try {
            const snap = await firebaseDB.ref('community_posts')
                .orderByChild('created_at')
                .limitToLast(50)
                .once('value');
            const val = snap.val();
            if (!val) return [];
            return Object.values(val)
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        } catch (e) {
            console.warn('Error cargando posts de comunidad:', e);
            return [];
        }
    }

    // --- Utilidades ---
    function _timeAgo(date) {
        const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
        if (seconds < 60) return 'hace un momento';
        const mins = Math.floor(seconds / 60);
        if (mins < 60) return `hace ${mins} min`;
        const hours = Math.floor(mins / 60);
        if (hours < 24) return `hace ${hours}h`;
        const days = Math.floor(hours / 24);
        if (days < 7) return `hace ${days}d`;
        return date.toLocaleDateString();
    }

    function _escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    return { render, afterRender, submitPost, reactToPost };
})();

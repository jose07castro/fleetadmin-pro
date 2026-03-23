/* ============================================
   FleetAdmin Pro — Comunidad
   Feed social para administradores y choferes
   Datos globales en /community_posts/
   Aislamiento por rol: dueños ven posts de dueños,
   choferes ven posts de choferes.
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

    // --- Sponsors para el carrusel ---
    const SPONSORS = [
        {
            id: 'leo_mecanica',
            name: '🔧 LEO MECÁNICA',
            image: 'assets/sponsor_leo_chevrolet.png?v=2',
            alt: 'LEO MECÁNICA — Chevrolet clásico rojo',
            location: '📍 Dorrego 330, Villa Gobernador Gálvez',
            phone: '📞 Tel/WA: 3413650105',
            whatsapp: 'https://wa.me/543413650105?text=Hola%20Leo,%20te%20contacto%20desde%20FleetAdmin%20Pro'
        },
        {
            id: 'lavadero_ayala',
            name: '🚿 LAVADERO AYALA',
            image: 'assets/sponsor_lavadero_ayala.png',
            alt: 'Lavadero Ayala — Lavado profesional',
            location: '📍 Av. San Martín 1520, Rosario',
            phone: '📞 Tel/WA: 3415551234',
            whatsapp: 'https://wa.me/543415551234?text=Hola,%20te%20contacto%20desde%20FleetAdmin%20Pro'
        }
    ];

    let _sponsorInterval = null;
    let _selectedCategory = '';
    let _selectedImageFile = null;
    let _selectedImagePreview = null;
    let _userInteractions = 0;

    // --- TTS Voice Notification state ---
    let _realtimeListenersActive = false;
    let _childAddedRef = null;
    let _childChangedRef = null;
    let _initialLoadComplete = false;
    let _lastTTSTime = 0;
    const TTS_COOLDOWN_MS = 3000; // 3 seconds between voice notifications
    let _knownPostKeys = new Set(); // Track posts loaded initially to skip them

    // --- Reaction definitions ---
    const REACTIONS = [
        { key: 'mate',     emoji: '🧉', label: 'Mate',            level: 0 },
        { key: 'estrella', emoji: '⭐',   label: 'Estrella',        level: 1 },
        { key: 'doradas',  emoji: '🌟',   label: 'Estrellas Doradas', level: 2 },
        { key: 'copa',     emoji: '🏆',   label: 'Copa del Mundo',  level: 3, unlockAt: 10 }
    ];

    async function render() {
        const posts = await _getPosts();
        const userName = Auth.getUserName();
        const displayPosts = posts.length > 0 ? posts : MOCK_POSTS;
        const isMock = posts.length === 0;

        // Count user interactions for gamification
        await _countUserInteractions();

        const role = Auth.getRole();
        const isDriver = role === 'driver';
        const communityTitle = isDriver ? '\ud83d\udcac Comunidad de Choferes' : '\ud83d\udcac Comunidad de Due\u00f1os';
        const communitySubtitle = isDriver
            ? 'Compart\u00ed el estado de la calle, alertas y novedades con tus compa\u00f1eros de ruta.'
            : 'Compart\u00ed experiencias, consejos y novedades con otros administradores de flota.';
        const backRoute = isDriver ? 'shifts' : 'dashboard';
        const backLabel = isDriver ? '\u2190 Volver a Turnos' : '\u2190 Volver al Panel';

        return `
        <div class="community-wall">
            <!-- Columna principal del feed (70%) -->
            <div class="community-main-col">
                <div class="community-header">
                    <div>
                        <h2 style="font-size:var(--font-size-2xl); font-weight:700; margin-bottom:var(--space-1);">
                            ${communityTitle}
                        </h2>
                        <p style="color:var(--text-secondary); font-size:var(--font-size-sm);">
                            ${communitySubtitle}
                        </p>
                    </div>
                    <button class="btn btn-ghost" onclick="Router.navigate('${backRoute}')" style="flex-shrink:0;">
                        ${backLabel}
                    </button>
                </div>

                ${isMock ? `
                <div style="text-align:center; padding:var(--space-3) 0 var(--space-4); color:var(--text-tertiary); font-size:var(--font-size-xs); border-bottom:1px solid var(--border-color); margin-bottom:var(--space-4);">
                    ✨ Publicaciones de ejemplo — ¡Publicá la primera para reemplazarlas!
                </div>
                ` : ''}

                <!-- Feed -->
                <div class="community-feed" id="communityFeed">
                    <!-- Compose card integrada como primer post -->
                    <div class="community-post card community-compose-card" id="communityComposeCard">
                        <div class="compose-card-top">
                            <div class="community-avatar">${(userName || 'U')[0].toUpperCase()}</div>
                            <div class="compose-card-input-wrapper" id="composeInputWrapper">
                                <textarea id="communityPostText" class="compose-card-textarea"
                                    placeholder="¿Qué tema querés debatir en la comunidad hoy?"
                                    maxlength="500" spellcheck="true" lang="es" autocorrect="on"></textarea>
                                <div class="compose-image-preview" id="composeImagePreview" style="display:none;">
                                    <img id="composeImageThumb" src="" alt="Preview" />
                                    <button class="compose-image-remove" onclick="CommunityModule.removeImage()" title="Quitar imagen">✕</button>
                                </div>
                            </div>
                        </div>
                        <div class="compose-card-bottom" id="composeBottom">
                            <div class="compose-card-divider"></div>
                            <div class="compose-card-actions">
                                <div class="compose-card-categories">
                                    <button class="compose-category-btn" data-category="debate" onclick="CommunityModule.selectCategory('debate')">
                                        🗣️ Debate
                                    </button>
                                    <button class="compose-category-btn" data-category="consulta" onclick="CommunityModule.selectCategory('consulta')">
                                        ❓ Consulta
                                    </button>
                                    <button class="compose-category-btn" data-category="alerta" onclick="CommunityModule.selectCategory('alerta')">
                                        🚨 Alerta
                                    </button>
                                    <label class="compose-category-btn compose-photo-btn" for="composeImageInput">
                                        📷 Foto
                                    </label>
                                    <input type="file" id="composeImageInput" accept="image/*" style="display:none;" onchange="CommunityModule.onImageSelected(this)" />
                                </div>
                                <div class="compose-card-right">
                                    <span id="communityCharCount" class="compose-card-counter">0 / 500</span>
                                    <button class="btn btn-primary community-publish-btn" onclick="CommunityModule.submitPost()">
                                        📤 Publicar
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>

                    ${displayPosts.map(p => _renderPost(p, isMock)).join('')}
                </div>
            </div>

            <!-- Columna de Sponsors (30%) — Carrusel -->
            <div class="community-sponsors-col">
                <div class="community-sponsor-card sponsor-ad-card sponsor-carousel" id="sponsorCarousel"
                     onmouseenter="CommunityModule.pauseCarousel()"
                     onmouseleave="CommunityModule.resumeCarousel()">
                    <h4>🤝 Sponsors</h4>
                    <div class="sponsor-slide-container" id="sponsorSlideContainer">
                        <div class="sponsor-ad-image-wrapper">
                            <img id="sponsorImg" src="${SPONSORS[0].image}" alt="${SPONSORS[0].alt}" class="sponsor-ad-image" />
                        </div>
                        <div class="sponsor-ad-info">
                            <h3 class="sponsor-ad-name" id="sponsorName">${SPONSORS[0].name}</h3>
                            <p class="sponsor-ad-location" id="sponsorLocation">${SPONSORS[0].location}</p>
                            <p class="sponsor-ad-phone" id="sponsorPhone">${SPONSORS[0].phone}</p>
                        </div>
                        <a id="sponsorCta" href="${SPONSORS[0].whatsapp}" target="_blank" rel="noopener noreferrer" class="sponsor-ad-cta">
                            💬 Contactar
                        </a>
                    </div>
                    <div class="sponsor-carousel-dots" id="sponsorDots">
                        ${SPONSORS.map((_, i) => `
                            <button class="sponsor-dot ${i === 0 ? 'active' : ''}" data-dot="${i}" aria-label="Sponsor ${i + 1}" onclick="CommunityModule.goToSponsor(${i})"></button>
                        `).join('')}
                    </div>
                </div>

                <!-- WhatsApp Group Invite -->
                <div class="community-sponsor-card" style="margin-top:var(--space-4); padding:var(--space-5); text-align:center;">
                    <h4 style="margin-bottom:var(--space-3);">💬 Grupo de WhatsApp</h4>
                    <p style="font-size:var(--font-size-xs); color:var(--text-secondary); margin-bottom:var(--space-4); line-height:1.5;">
                        ${isDriver
                            ? 'Unite al grupo de <strong>Conductores</strong> para compartir alertas, estado de calles y más.'
                            : 'Unite al grupo de <strong>Dueños</strong> para compartir experiencias y novedades del rubro.'}
                    </p>
                    <a href="${isDriver
                            ? 'https://chat.whatsapp.com/D3CGMxKDqSx1vHjILi6LtW'
                            : 'https://chat.whatsapp.com/HxnVSmJSKBwGTcDLPZAzfc'}"
                       target="_blank" rel="noopener noreferrer"
                       class="sponsor-ad-cta" style="border-radius:var(--radius-lg); display:inline-block; padding:var(--space-3) var(--space-6);">
                        💬 Unirse al Grupo
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
        const currentUserId = Auth.getUserId() || Auth.getUserName();
        const isAuthor = !isMock && (post.author_id === currentUserId);

        const categoryBadge = post.category ? `<span class="community-category-badge community-cat-${post.category}">${post.category === 'debate' ? '🗣️ Debate' : post.category === 'consulta' ? '❓ Consulta' : '🚨 Alerta'}</span>` : '';

        const escapedContent = _escapeHTML(post.content);

        const postMenu = isAuthor ? `
            <div class="post-menu-wrapper">
                <button class="post-menu-trigger" onclick="event.stopPropagation(); CommunityModule.togglePostMenu('${post.id}')" title="Opciones">⋮</button>
                <div class="post-menu-dropdown" id="post-menu-${post.id}">
                    <button class="post-menu-item" onclick="CommunityModule.editPost('${post.id}')">
                        ✏️ Editar
                    </button>
                    <button class="post-menu-item post-menu-danger" onclick="CommunityModule.deletePost('${post.id}')">
                        🗑️ Eliminar
                    </button>
                </div>
            </div>
        ` : '';

        return `
            <div class="community-post card" id="post-${post.id}">
                <div class="community-post-header">
                    <div class="community-avatar">${initial}</div>
                    <div style="flex:1;">
                        <div class="community-post-author">${post.author_name || 'Anónimo'} ${categoryBadge}</div>
                        <div class="community-post-time">${timeAgo}</div>
                    </div>
                    ${post.fleet_city ? `
                        <span class="community-location-badge">
                            📍 ${post.fleet_city}
                        </span>
                    ` : ''}
                    ${postMenu}
                </div>
                <div class="community-post-body" id="post-body-${post.id}">${escapedContent}</div>
                ${post.image_url ? `
                    <div class="community-post-image">
                        <img src="${post.image_url}" alt="Imagen del post" loading="lazy" onclick="window.open('${post.image_url}','_blank')" />
                    </div>
                ` : ''}
                <div class="community-post-footer">
                    <div class="reaction-trigger-wrapper">
                        <button class="community-react-btn reaction-main-btn" onclick="event.stopPropagation(); CommunityModule.toggleReactionPicker('${post.id}')">
                            ❤️ Reaccionar
                        </button>
                        <div class="reaction-picker" id="reaction-picker-${post.id}">
                            ${REACTIONS.map(r => {
                                const isLocked = r.unlockAt && _userInteractions < r.unlockAt;
                                return `
                                    <button class="reaction-option ${isLocked ? 'reaction-locked' : ''}" 
                                        onclick="CommunityModule.reactToPost('${post.id}', '${r.key}')"
                                        title="${r.label}${isLocked ? ' (Bloqueado)' : ''}">
                                        <span class="reaction-emoji">${r.emoji}</span>
                                    </button>
                                `;
                            }).join('')}
                        </div>
                    </div>
                    <div class="reaction-counts">
                        ${REACTIONS.map(r => {
                            const count = (post.reactions && post.reactions[r.key]) || 0;
                            return count > 0 ? `<span class="reaction-count-badge">${r.emoji} ${count}</span>` : '';
                        }).join('')}
                    </div>
                    <button class="community-react-btn" onclick="CommunityModule.toggleComment('${post.id}')">
                        💬 Comentar
                    </button>
                </div>
                <div class="community-comment-box" id="comment-box-${post.id}" style="display:none;">
                    <div class="comment-list" id="comment-list-${post.id}">
                        ${_renderComments(post.comments)}
                    </div>
                    <div class="comment-input-row">
                        <input type="text" class="comment-input" id="comment-input-${post.id}"
                            placeholder="Escribí tu comentario..." maxlength="280"
                            spellcheck="true" lang="es" autocorrect="on"
                            onkeydown="if(event.key==='Enter'){CommunityModule.submitComment('${post.id}');event.preventDefault();}" />
                        <button class="comment-send-btn" onclick="CommunityModule.submitComment('${post.id}')">
                            ➤
                        </button>
                    </div>
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

            // Upload image if selected
            let imageUrl = '';
            if (_selectedImageFile) {
                try {
                    const fileName = `community_images/${Date.now()}_${_selectedImageFile.name}`;
                    const storageRef = firebaseStorage.ref(fileName);
                    const snapshot = await storageRef.put(_selectedImageFile);
                    imageUrl = await snapshot.ref.getDownloadURL();
                } catch (imgErr) {
                    console.error('Error subiendo imagen:', imgErr);
                    Components.showToast('⚠️ Error al subir la imagen, publicando sin imagen...', 'warning');
                }
            }

            // Obtener ciudad de la flota para mostrar en el post
            let fleetCity = '';
            try {
                const location = await DB.getSetting('location');
                if (location && location.city) {
                    fleetCity = location.city;
                }
            } catch (e) { /* sin ubicación */ }

            // Determinar rol ESTRICTAMENTE — NO usar fallback 'owner'
            const currentRole = Auth.getRole();
            console.log('📝 Comunidad: Rol del usuario al publicar:', currentRole);
            if (!currentRole) {
                console.error('❌ Comunidad: No se pudo determinar el rol del usuario');
                Components.showToast('❌ Error: sesión no válida. Cerrá e iniciá sesión de nuevo.', 'danger');
                return;
            }

            const postData = {
                author_id: Auth.getUserId() || Auth.getUserName(),
                author_name: Auth.getUserName(),
                author_role: currentRole,
                fleet_id: Auth.getFleetId(),
                fleet_city: fleetCity,
                category: _selectedCategory || '',
                content: content,
                image_url: imageUrl,
                targetAudience: currentRole,
                likes: 0,
                insights: 0
            };

            await _addPost(postData);

            // Reset state
            _selectedImageFile = null;
            _selectedImagePreview = null;
            _selectedCategory = '';

            Components.showToast('✅ ¡Publicación enviada!', 'success');
            Router.navigate('community');
        } catch (error) {
            console.error('❌ Error publicando en comunidad:', error);
            Components.showToast('❌ Error al publicar: ' + (error.message || error), 'danger');
        }
    }

    // --- Reaccionar a un post ---
    async function reactToPost(postId, reactionKey) {
        // Check if locked
        const reactionDef = REACTIONS.find(r => r.key === reactionKey);
        if (reactionDef && reactionDef.unlockAt && _userInteractions < reactionDef.unlockAt) {
            Components.showToast(`🔒 ¡Interactú ${reactionDef.unlockAt} veces en la comunidad para desbloquear la ${reactionDef.label}! (Llevás ${_userInteractions})`, 'warning');
            return;
        }

        // Close picker
        document.querySelectorAll('.reaction-picker.open').forEach(p => p.classList.remove('open'));

        try {
            const ref = firebaseDB.ref(`community_posts/${postId}/reactions/${reactionKey}`);
            await ref.transaction(current => (current || 0) + 1);
            Router.navigate('community');
        } catch (e) {
            console.warn('Error al reaccionar:', e);
        }
    }

    // --- Toggle reaction picker ---
    function toggleReactionPicker(postId) {
        // Close all others
        document.querySelectorAll('.reaction-picker.open').forEach(p => p.classList.remove('open'));
        const picker = document.getElementById('reaction-picker-' + postId);
        if (picker) picker.classList.toggle('open');
    }

    // --- Count user interactions (posts + comments) ---
    async function _countUserInteractions() {
        try {
            const userId = Auth.getUserId() || Auth.getUserName();
            if (!userId) { _userInteractions = 0; return; }
            const snap = await firebaseDB.ref('community_posts').once('value');
            const posts = snap.val();
            if (!posts) { _userInteractions = 0; return; }

            let count = 0;
            Object.values(posts).forEach(post => {
                // Count posts by this user
                if (post.author_id === userId) count++;
                // Count comments by this user
                if (post.comments) {
                    Object.values(post.comments).forEach(c => {
                        if (c.author === (Auth.getUserName() || userId)) count++;
                    });
                }
            });
            _userInteractions = count;
        } catch (e) {
            console.warn('Error contando interacciones:', e);
            _userInteractions = 0;
        }
    }

    // --- afterRender: configurar compose card + carrusel sponsors ---
    function afterRender() {
        // JS fallback: add class for left-alignment override (for browsers without :has())
        const appContent = document.querySelector('.app-content');
        if (appContent) appContent.classList.add('community-active');

        const textarea = document.getElementById('communityPostText');
        const counter = document.getElementById('communityCharCount');

        // Char counter
        if (textarea && counter) {
            textarea.addEventListener('input', () => {
                counter.textContent = `${textarea.value.length} / 500`;
            });
        }

        // Close post menus and reaction pickers on click outside
        document.addEventListener('click', () => {
            document.querySelectorAll('.post-menu-dropdown.open').forEach(m => m.classList.remove('open'));
            document.querySelectorAll('.reaction-picker.open').forEach(p => p.classList.remove('open'));
        });

        // --- Sponsor Carousel ---
        _initSponsorCarousel();

        // --- Real-time TTS listeners for new posts/comments ---
        _startRealtimeListeners();
    }

    // --- Sponsor Carousel (single-slot, DOM swap with fade) ---
    let _currentSponsor = 0;

    function _startCarouselTimer() {
        if (_sponsorInterval) clearInterval(_sponsorInterval);
        _sponsorInterval = setInterval(() => {
            _currentSponsor = (_currentSponsor + 1) % SPONSORS.length;
            _showSponsor(_currentSponsor);
        }, 6000);
    }

    function _showSponsor(index) {
        const container = document.getElementById('sponsorSlideContainer');
        if (!container) return;

        // Fade out
        container.classList.add('sponsor-fading');

        setTimeout(() => {
            const s = SPONSORS[index];
            // Swap content
            const img = document.getElementById('sponsorImg');
            const name = document.getElementById('sponsorName');
            const loc = document.getElementById('sponsorLocation');
            const phone = document.getElementById('sponsorPhone');
            const cta = document.getElementById('sponsorCta');

            if (img) { img.src = s.image; img.alt = s.alt; }
            if (name) name.textContent = s.name;
            if (loc) loc.textContent = s.location;
            if (phone) phone.textContent = s.phone;
            if (cta) cta.href = s.whatsapp;

            // Update dots
            document.querySelectorAll('.sponsor-dot').forEach((dot, i) => {
                dot.classList.toggle('active', i === index);
            });

            // Fade in
            container.classList.remove('sponsor-fading');
        }, 400);
    }

    function _initSponsorCarousel() {
        if (SPONSORS.length <= 1) return;
        _currentSponsor = 0;
        _startCarouselTimer();
        console.log('✅ Sponsor carousel iniciado — ' + SPONSORS.length + ' sponsors, rotando cada 6s');
    }

    function pauseCarousel() {
        if (_sponsorInterval) {
            clearInterval(_sponsorInterval);
            _sponsorInterval = null;
        }
    }

    function resumeCarousel() {
        _startCarouselTimer();
    }

    function goToSponsor(index) {
        _currentSponsor = index;
        _showSponsor(index);
        // Reset timer
        _startCarouselTimer();
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
                .limitToLast(100)
                .once('value');
            const val = snap.val();
            if (!val) return [];

            // Filtrar por rol del usuario activo — SIN fallback peligroso
            const userRole = Auth.getRole();
            console.log('📋 Comunidad: Cargando posts para rol:', userRole);

            if (!userRole) {
                console.warn('⚠️ Comunidad: Rol no definido, no se pueden filtrar posts');
                return [];
            }

            const allPosts = Object.values(val);
            const filtered = allPosts.filter(p => {
                // Posts sin targetAudience (legacy) — intentar usar authorRole como fallback
                const audience = p.targetAudience || p.author_role;
                if (!audience) {
                    // Posts legacy sin ningún campo de rol, solo mostrar a owners
                    return userRole === 'owner';
                }
                return audience === userRole;
            });

            console.log(`📋 Comunidad: ${allPosts.length} posts totales → ${filtered.length} para rol '${userRole}'`);

            return filtered
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
                .slice(0, 50);
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

    // --- Selección de categoría ---
    function selectCategory(cat) {
        if (_selectedCategory === cat) {
            _selectedCategory = '';
        } else {
            _selectedCategory = cat;
        }
        // Update button highlights
        document.querySelectorAll('.compose-category-btn').forEach(btn => {
            const btnCat = btn.getAttribute('data-category');
            btn.classList.toggle('active', btnCat === _selectedCategory);
        });
    }

    // --- Render existing comments ---
    function _renderComments(comments) {
        if (!comments) return '';
        const commentArr = Object.values(comments);
        if (commentArr.length === 0) return '';
        return commentArr
            .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
            .map(c => {
                const initial = (c.author || '?')[0].toUpperCase();
                const timeAgo = _timeAgo(new Date(c.created_at));
                return `
                    <div class="comment-item">
                        <div class="comment-avatar">${initial}</div>
                        <div class="comment-body">
                            <span class="comment-author">${_escapeHTML(c.author || 'Anónimo')}</span>
                            <span class="comment-text">${_escapeHTML(c.text)}</span>
                            <span class="comment-time">${timeAgo}</span>
                        </div>
                    </div>
                `;
            }).join('');
    }

    // --- Toggle comment box en un post ---
    function toggleComment(postId) {
        const box = document.getElementById('comment-box-' + postId);
        if (!box) return;
        const isVisible = box.style.display !== 'none';
        box.style.display = isVisible ? 'none' : 'block';
        if (!isVisible) {
            const input = document.getElementById('comment-input-' + postId);
            if (input) input.focus();
        }
    }

    // --- Enviar comentario ---
    async function submitComment(postId) {
        const input = document.getElementById('comment-input-' + postId);
        if (!input) {
            console.error('❌ Comment input not found for postId:', postId);
            return;
        }
        const text = input.value?.trim();
        if (!text || text.length < 2) {
            Components.showToast('⚠️ Escribí al menos 2 caracteres.', 'warning');
            return;
        }

        // Disable button to prevent double-submit
        const sendBtn = input.parentElement?.querySelector('.comment-send-btn');
        if (sendBtn) sendBtn.disabled = true;

        try {
            const userName = Auth.getUserName() || 'Anónimo';
            const now = new Date().toISOString();
            const commentData = {
                author: userName,
                author_id: Auth.getUserId() || Auth.getUserName(),
                text: text,
                created_at: now
            };

            console.log('💬 Enviando comentario al post:', postId, commentData);

            const ref = firebaseDB.ref(`community_posts/${postId}/comments`).push();
            await ref.set(commentData);

            console.log('💬 ✅ Comentario guardado con ID:', ref.key);

            // Optimistic UI update — append comment immediately without reload
            const commentList = document.getElementById('comment-list-' + postId);
            if (commentList) {
                const initial = (userName || '?')[0].toUpperCase();
                const newCommentHTML = `
                    <div class="comment-item" style="animation: fadeIn 0.3s ease;">
                        <div class="comment-avatar">${initial}</div>
                        <div class="comment-body">
                            <span class="comment-author">${_escapeHTML(userName)}</span>
                            <span class="comment-text">${_escapeHTML(text)}</span>
                            <span class="comment-time">hace un momento</span>
                        </div>
                    </div>
                `;
                commentList.insertAdjacentHTML('beforeend', newCommentHTML);
            }

            input.value = '';
            Components.showToast('✅ Comentario enviado', 'success');
        } catch (e) {
            console.error('❌ Error al comentar en post', postId, ':', e);
            Components.showToast('❌ Error al comentar: ' + (e.message || e), 'danger');
        } finally {
            if (sendBtn) sendBtn.disabled = false;
        }
    }

    // --- Post Menu (three-dot) ---
    function togglePostMenu(postId) {
        const menu = document.getElementById('post-menu-' + postId);
        if (!menu) return;
        // Close all other open menus first
        document.querySelectorAll('.post-menu-dropdown.open').forEach(m => {
            if (m !== menu) m.classList.remove('open');
        });
        menu.classList.toggle('open');
    }

    // --- Delete Post ---
    async function deletePost(postId) {
        // Close menu
        document.querySelectorAll('.post-menu-dropdown.open').forEach(m => m.classList.remove('open'));

        const confirmed = confirm('¿Estás seguro de que querés eliminar esta publicación?');
        if (!confirmed) return;

        try {
            await firebaseDB.ref('community_posts/' + postId).remove();
            Components.showToast('🗑️ Publicación eliminada', 'success');
            Router.navigate('community');
        } catch (e) {
            console.error('Error al eliminar post:', e);
            Components.showToast('❌ Error al eliminar', 'danger');
        }
    }

    // --- Edit Post (inline) ---
    function editPost(postId) {
        // Close menu
        document.querySelectorAll('.post-menu-dropdown.open').forEach(m => m.classList.remove('open'));

        const body = document.getElementById('post-body-' + postId);
        if (!body) return;

        const currentText = body.textContent;
        body.innerHTML = `
            <textarea class="post-edit-textarea" id="post-edit-text-${postId}" maxlength="500">${_escapeHTML(currentText)}</textarea>
            <div class="post-edit-actions">
                <button class="btn btn-sm btn-primary" onclick="CommunityModule.saveEditPost('${postId}')">✅ Guardar Cambios</button>
                <button class="btn btn-sm btn-ghost" onclick="CommunityModule.cancelEditPost('${postId}', '${encodeURIComponent(currentText)}')">❌ Cancelar</button>
            </div>
        `;
        const ta = document.getElementById('post-edit-text-' + postId);
        if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
    }

    async function saveEditPost(postId) {
        const ta = document.getElementById('post-edit-text-' + postId);
        const newText = ta?.value?.trim();
        if (!newText || newText.length < 3) {
            Components.showToast('⚠️ El texto debe tener al menos 3 caracteres.', 'warning');
            return;
        }
        try {
            await firebaseDB.ref('community_posts/' + postId).update({ content: newText });
            Components.showToast('✅ Publicación editada', 'success');
            Router.navigate('community');
        } catch (e) {
            console.error('Error al editar post:', e);
            Components.showToast('❌ Error al guardar', 'danger');
        }
    }

    function cancelEditPost(postId, encodedOriginal) {
        const body = document.getElementById('post-body-' + postId);
        if (body) body.textContent = decodeURIComponent(encodedOriginal);
    }

    // --- Image Upload Helpers ---
    function onImageSelected(input) {
        const file = input.files?.[0];
        if (!file) return;

        // Validate: max 5MB
        if (file.size > 5 * 1024 * 1024) {
            Components.showToast('⚠️ La imagen no puede superar 5MB.', 'warning');
            input.value = '';
            return;
        }

        _selectedImageFile = file;
        const reader = new FileReader();
        reader.onload = (e) => {
            _selectedImagePreview = e.target.result;
            const preview = document.getElementById('composeImagePreview');
            const thumb = document.getElementById('composeImageThumb');
            if (preview && thumb) {
                thumb.src = _selectedImagePreview;
                preview.style.display = 'block';
            }
        };
        reader.readAsDataURL(file);
    }

    function removeImage() {
        _selectedImageFile = null;
        _selectedImagePreview = null;
        const preview = document.getElementById('composeImagePreview');
        const input = document.getElementById('composeImageInput');
        if (preview) preview.style.display = 'none';
        if (input) input.value = '';
    }

    // ============================================
    // TTS Voice Notification — "Comunidad"
    // ============================================

    /**
     * Speak "Comunidad" using Web Speech API.
     * Includes cooldown to prevent rapid-fire and browser compatibility guard.
     */
    function _speakComunidad() {
        try {
            if (!('speechSynthesis' in window)) {
                console.warn('🔇 TTS: speechSynthesis no soportado en este navegador');
                return;
            }

            const now = Date.now();
            if (now - _lastTTSTime < TTS_COOLDOWN_MS) {
                console.log('🔇 TTS: cooldown activo, omitiendo');
                return;
            }
            _lastTTSTime = now;

            // Cancel any ongoing speech
            window.speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance('Comunidad');
            utterance.lang = 'es-ES';
            utterance.rate = 1.0;
            window.speechSynthesis.speak(utterance);
            console.log('🔊 TTS: "Comunidad" reproducido');
        } catch (e) {
            console.warn('🔇 TTS: Error al reproducir voz:', e);
        }
    }

    /**
     * Start Firebase real-time listeners for new posts and comments.
     * Skips initial data load and own actions.
     */
    function _startRealtimeListeners() {
        if (_realtimeListenersActive) return;

        const currentUserId = Auth.getUserId() || Auth.getUserName();
        const currentRole = Auth.getRole();
        if (!currentUserId || !currentRole) {
            console.warn('⚠️ TTS: No hay usuario/rol activo, listeners no iniciados');
            return;
        }

        console.log('🔊 TTS: Iniciando listeners en tiempo real para rol:', currentRole);

        _initialLoadComplete = false;
        _knownPostKeys.clear();

        const postsRef = firebaseDB.ref('community_posts');

        // Step 1: Load existing post keys first, THEN activate listeners
        postsRef.once('value').then(snap => {
            const val = snap.val();
            if (val) {
                Object.keys(val).forEach(key => _knownPostKeys.add(key));
            }
            _initialLoadComplete = true;
            console.log(`🔊 TTS: ${_knownPostKeys.size} posts existentes cargados, listeners activos`);
        }).catch(e => {
            console.warn('⚠️ TTS: Error cargando posts iniciales:', e);
            _initialLoadComplete = true; // Proceed anyway
        });

        // --- Listener: new posts (child_added) ---
        _childAddedRef = postsRef.on('child_added', (snapshot) => {
            if (!_initialLoadComplete) return; // Skip initial load

            const post = snapshot.val();
            if (!post) return;

            // Already known? (safety check)
            if (_knownPostKeys.has(snapshot.key)) return;
            _knownPostKeys.add(snapshot.key);

            // Filter by role/audience
            const audience = post.targetAudience || post.author_role;
            if (audience !== currentRole) return;

            // Filter own posts
            if (post.author_id === currentUserId) return;

            console.log('🔊 TTS: Nuevo post detectado de:', post.author_name);
            _speakComunidad();
        });

        // --- Listener: new comments (child_changed on post) ---
        _childChangedRef = postsRef.on('child_changed', (snapshot) => {
            if (!_initialLoadComplete) return;

            const post = snapshot.val();
            if (!post || !post.comments) return;

            // Filter by role/audience
            const audience = post.targetAudience || post.author_role;
            if (audience !== currentRole) return;

            // Find the latest comment
            const commentEntries = Object.values(post.comments);
            if (commentEntries.length === 0) return;

            const latestComment = commentEntries.reduce((latest, c) => {
                if (!latest) return c;
                return new Date(c.created_at) > new Date(latest.created_at) ? c : latest;
            }, null);

            if (!latestComment) return;

            // Filter own comments (check both author_id and author name)
            const commentAuthorId = latestComment.author_id || latestComment.author;
            if (commentAuthorId === currentUserId || latestComment.author === Auth.getUserName()) return;

            // Only notify if comment is recent (within last 10 seconds)
            const commentAge = Date.now() - new Date(latestComment.created_at).getTime();
            if (commentAge > 10000) return;

            console.log('🔊 TTS: Nuevo comentario detectado de:', latestComment.author);
            _speakComunidad();
        });

        _realtimeListenersActive = true;
    }

    /**
     * Stop and detach all Firebase real-time listeners.
     */
    function _stopRealtimeListeners() {
        if (!_realtimeListenersActive) return;

        const postsRef = firebaseDB.ref('community_posts');
        if (_childAddedRef) {
            postsRef.off('child_added', _childAddedRef);
            _childAddedRef = null;
        }
        if (_childChangedRef) {
            postsRef.off('child_changed', _childChangedRef);
            _childChangedRef = null;
        }

        _realtimeListenersActive = false;
        _initialLoadComplete = false;
        _knownPostKeys.clear();
        console.log('🔊 TTS: Listeners detenidos');
    }

    /**
     * Cleanup — called when navigating away from Community.
     */
    function cleanup() {
        _stopRealtimeListeners();
        if (_sponsorInterval) {
            clearInterval(_sponsorInterval);
            _sponsorInterval = null;
        }
    }

    return { render, afterRender, cleanup, submitPost, reactToPost, pauseCarousel, resumeCarousel, goToSponsor, selectCategory, toggleComment, submitComment, togglePostMenu, deletePost, editPost, saveEditPost, cancelEditPost, onImageSelected, removeImage, toggleReactionPicker };
})();

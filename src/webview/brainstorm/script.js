// @ts-nocheck
// Brainstorm Chat — Script
// Manages chat interactions, model dropdown, and clipboard features.

const vscode = acquireVsCodeApi();

// ── DOM References ──────────────────────────────────
const appWrapper = document.getElementById('app-wrapper');
const chatContainer = document.getElementById('chat-container');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const clearBtn = document.getElementById('clear-btn');
const errorDisplay = document.getElementById('error-display');
const thinkingIndicator = document.getElementById('thinking-indicator');
const thinkingName = document.getElementById('thinking-name');
const modelDropdown = document.getElementById('model-dropdown');
const dropdownTrigger = document.getElementById('dropdown-trigger');
const optionsList = document.getElementById('dropdown-options-list');
const selectedModelEl = document.getElementById('selected-model-name');
const codebaseToggle = document.getElementById('codebase-toggle');
const searchInput = document.getElementById('dropdown-search');

let currentAiMessageElement = null;
let currentModelName = '';
let modelsData = {};
let shouldAutoScroll = true;

// ── SVG Icons ───────────────────────────────────────
const COPY_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
const _CHECK_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;

// Notify backend we're ready
vscode.postMessage({ type: 'webview-ready' });

// ── State Transitions ──────────────────────────────
function switchToChatMode() {
    if (appWrapper.classList.contains('chat-mode')) {
        return;
    }
    appWrapper.classList.remove('hero-mode');
    appWrapper.classList.add('chat-mode');
}

function switchToHeroMode() {
    appWrapper.classList.remove('chat-mode');
    appWrapper.classList.add('hero-mode');
}

// ── Auto-resize textarea ───────────────────────────
promptInput.addEventListener('input', () => {
    promptInput.style.height = 'auto';
    promptInput.style.height = `${Math.min(promptInput.scrollHeight, 180)}px`;
});

// ── Codebase Toggle ────────────────────────────────
codebaseToggle.addEventListener('click', () => {
    const isActive = codebaseToggle.classList.toggle('active');
    vscode.postMessage({ type: 'toggle-codebase', value: isActive });
});

// ── Custom Dropdown Logic ─────────────────────────
let dropdownOpen = false;

function openDropdown() {
    dropdownOpen = true;
    optionsList.classList.add('show');
    dropdownTrigger.classList.add('active');
    if (searchInput) {
        searchInput.value = '';
        searchInput.focus();
        filterDropdown('');
    }
    // Scroll active model into view
    requestAnimationFrame(() => {
        const active = optionsList.querySelector('.dropdown-option.selected');
        if (active) {
            active.scrollIntoView({ block: 'nearest' });
        }
    });
}

function closeDropdown() {
    dropdownOpen = false;
    optionsList.classList.remove('show');
    dropdownTrigger.classList.remove('active');
}

function toggleDropdown() {
    if (dropdownOpen) {
        closeDropdown();
    } else {
        openDropdown();
    }
}

dropdownTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleDropdown();
});

document.addEventListener('click', (e) => {
    if (!modelDropdown.contains(e.target)) {
        closeDropdown();
    }
});

// ── Dropdown Search / Filter ──────────────────────
if (searchInput) {
    searchInput.addEventListener('input', (e) => {
        filterDropdown(e.target.value);
    });
    searchInput.addEventListener('click', (e) => e.stopPropagation());
    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeDropdown();
        }
    });
}

function filterDropdown(query) {
    const normalizedQuery = query.toLowerCase().trim();
    const groups = optionsList.querySelectorAll('.dropdown-provider-group');

    groups.forEach((group) => {
        const options = group.querySelectorAll('.dropdown-option');
        let visibleCount = 0;

        options.forEach((opt) => {
            const name = (opt.getAttribute('data-model-name') || '').toLowerCase();
            const matches = !normalizedQuery || name.includes(normalizedQuery);
            opt.style.display = matches ? '' : 'none';
            if (matches) {
                visibleCount++;
            }
        });

        // Hide entire provider group if no models match
        group.style.display = visibleCount > 0 ? '' : 'none';
    });
}

function handleModelSelect(modelInfo) {
    currentModelName = modelInfo.name;
    selectedModelEl.textContent = modelInfo.name;

    vscode.postMessage({
        type: 'change-model',
        value: {
            name: modelInfo.name,
            providerType: modelInfo.providerType,
            endpoint: modelInfo.endpoint,
        },
    });

    closeDropdown();
}

// ── Chat Functions ─────────────────────────────────
function appendMessage(role) {
    const el = document.createElement('div');
    el.className = `message message-${role}`;
    chatContainer.appendChild(el);
    scrollToBottom();
    return el;
}

/**
 * Creates a copy button element for user messages.
 * @param {string} text — The message text to copy.
 * @returns {HTMLButtonElement}
 */
function createUserCopyButton(text) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'user-copy-btn copy-btn';
    btn.setAttribute('data-clipboard', text);
    btn.title = 'Copy message';
    btn.innerHTML = `<span class="copy-icon-wrapper">${COPY_SVG}</span><svg class="check-icon" style="display:none;" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
    return btn;
}

function sendMessage() {
    const text = promptInput.value.trim();
    if (!text) {
        return;
    }

    errorDisplay.textContent = '';
    switchToChatMode();

    const userEl = appendMessage('user');
    userEl.textContent = text;

    // Inject the copy button into the user message
    const copyBtn = createUserCopyButton(text);
    userEl.appendChild(copyBtn);

    promptInput.value = '';
    promptInput.style.height = 'auto';

    // Reset auto-scroll when user sends a new message
    shouldAutoScroll = true;

    vscode.postMessage({
        type: 'chat-message',
        value: { text },
    });
}

sendBtn.addEventListener('click', sendMessage);

clearBtn.addEventListener('click', () => {
    vscode.postMessage({ type: 'clear-chat' });
    chatContainer.innerHTML = '';
    errorDisplay.textContent = '';
    currentAiMessageElement = null;
    shouldAutoScroll = true;
    switchToHeroMode();
});

promptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage();
    }
});

// ── Copy Button (event delegation) ──────────────────
chatContainer.addEventListener('click', (e) => {
    const btn = e.target.closest('.copy-btn');
    if (!btn) {
        return;
    }

    const rawText = btn.getAttribute('data-clipboard');
    if (!rawText) {
        return;
    }

    navigator.clipboard.writeText(rawText).then(() => {
        btn.classList.add('copied');
        const copyIcon = btn.querySelector('.copy-icon-wrapper');
        const checkIcon = btn.querySelector('.check-icon');
        if (copyIcon && checkIcon) {
            copyIcon.style.display = 'none';
            checkIcon.style.display = 'inline-block';
            setTimeout(() => {
                copyIcon.style.display = 'inline-block';
                checkIcon.style.display = 'none';
                btn.classList.remove('copied');
            }, 2000);
        }
    });
});

// ── Smart Auto-Scroll ──────────────────────────────
// Always scroll during streaming unless user manually scrolled up
chatContainer.addEventListener('scroll', () => {
    const distFromBottom =
        chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
    shouldAutoScroll = distFromBottom < 80;
});

function scrollToBottom() {
    if (shouldAutoScroll) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }
}

// ── Build Model Dropdown with Provider Groups ──────
function buildModelDropdown(groupedModels, currentModel) {
    // Clear existing options but keep the search input
    const existingGroups = optionsList.querySelectorAll(
        '.dropdown-provider-group, .dropdown-empty',
    );
    existingGroups.forEach((el) => el.remove());

    const entries = Object.entries(groupedModels);

    if (entries.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'dropdown-empty';
        empty.textContent = 'No models available';
        optionsList.appendChild(empty);
        return;
    }

    // Deduplicate: track unique model names across all providers
    const seen = new Set();

    for (const [provider, models] of entries) {
        // Create a provider group container
        const groupEl = document.createElement('div');
        groupEl.className = 'dropdown-provider-group';

        const head = document.createElement('div');
        head.className = 'dropdown-group-header';
        head.innerHTML = `<span class="provider-name">${provider}</span><span class="provider-count">${models.length}</span>`;
        groupEl.appendChild(head);

        for (const model of models) {
            // Skip duplicates across providers
            const uniqueKey = `${model.providerType}::${model.name}`;
            if (seen.has(uniqueKey)) {
                continue;
            }
            seen.add(uniqueKey);

            const isSelected = model.isCurrent || (currentModel && model.name === currentModel);

            const opt = document.createElement('div');
            opt.className = `dropdown-option${isSelected ? ' selected' : ''}`;
            opt.setAttribute('data-model-name', model.name);

            if (isSelected) {
                selectedModelEl.textContent = model.name;
                currentModelName = model.name;
            }

            opt.innerHTML = `
                <span class="option-label">${model.name}</span>
                <div class="active-dot"></div>
            `;

            opt.addEventListener('click', (e) => {
                e.stopPropagation();
                handleModelSelect(model);
            });

            groupEl.appendChild(opt);
        }

        optionsList.appendChild(groupEl);
    }
}

// ── Message Handler ────────────────────────────────
window.addEventListener('message', (event) => {
    const msg = event.data;
    switch (msg.type) {
        case 'set-models-list':
            modelsData = msg.groupedModels || {};
            buildModelDropdown(modelsData, msg.currentModel);
            if (msg.currentModel) {
                currentModelName = msg.currentModel;
            }
            break;

        case 'set-model-name':
            currentModelName = msg.value;
            selectedModelEl.textContent = msg.value;
            // Update selection highlight
            document.querySelectorAll('.dropdown-option').forEach((opt) => {
                const targetId = opt.getAttribute('data-model-name');
                opt.classList.toggle('selected', targetId === msg.value);
            });
            break;

        case 'set-codebase-state':
            if (msg.value) {
                codebaseToggle.classList.add('active');
            } else {
                codebaseToggle.classList.remove('active');
            }
            break;

        case 'set-thinking':
            thinkingName.textContent = msg.value || currentModelName || 'Glyph';
            thinkingIndicator.classList.add('active');
            shouldAutoScroll = true;
            scrollToBottom();
            break;

        case 'stream-update':
            thinkingIndicator.classList.remove('active');
            if (!currentAiMessageElement) {
                currentAiMessageElement = appendMessage('ai');
            }
            currentAiMessageElement.innerHTML = msg.html;
            scrollToBottom();
            break;

        case 'generation-complete':
            thinkingIndicator.classList.remove('active');
            currentAiMessageElement = null;
            break;

        case 'error-notification':
            thinkingIndicator.classList.remove('active');
            errorDisplay.textContent = msg.value;
            currentAiMessageElement = null;
            break;
    }
});

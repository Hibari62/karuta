// public/pregame.js
let seiyuuData = [];
let totalCardsToSelect = 50; // Valeur par défaut
let selectedMap     = {}; // { [cardId]: true/false }
// ===== Références DOM =====
const settingsBox       = document.getElementById('settingsBox');
const themeSelect       = document.getElementById('themeSelect');
const cardsCountInput   = document.getElementById('cardsCount');
const validateSettingsBtn = document.getElementById('validateSettingsBtn');

const cardSelectBox     = document.getElementById('cardSelectBox');
const backBtn           = document.getElementById('backBtn');
const randomBtn         = document.getElementById('randomBtn');
const maleBtn           = document.getElementById('maleBtn');
const femaleBtn         = document.getElementById('femaleBtn');
const selectedCounter   = document.getElementById('selectedCounter');
const cardsListDiv      = document.getElementById('cardsList');
const startGameBtn      = document.getElementById('startGameBtn');

function sortByName(a, b) {
  const na = a.name.toLowerCase();
  const nb = b.name.toLowerCase();
  if (na < nb) return -1;
  if (na > nb) return 1;
  return 0;
}

socket.on('join_success', ({ roomName, teams, state, totalCards, seiyuuList, selectedMap: initialMap }) => {
  window.currentRoom   = roomName;
  const currentUsername   = window.currentUsername;
  renderTeams(teams);
  if (state === 'settings') {
    // On reste / revient sur la boîte de réglages
    settingsBox.style.display   = 'block';
    cardSelectBox.style.display = 'none';

    // Positionner la valeur du champ "Nombre de cartes" sur ce que le serveur a (même si c'est 50 par défaut)
    cardsCountInput.value = totalCards;
    totalCardsToSelect = totalCards;
    updateValidateButton();
  } else if (state === 'card_select') {
    // On doit montrer la boîte de sélection des cartes
    settingsBox.style.display   = 'none';
    cardSelectBox.style.display = 'flex';

    totalCardsToSelect = totalCards;
    seiyuuData         = [...seiyuuList];
    selectedMap = {};

    seiyuuData.forEach(c => {
      selectedMap[c.id] = initialMap[c.id] === true;
    });

    renderCardList();
    // Marquer visuellement les cartes déjà cochées
    Object.entries(selectedMap).forEach(([cardId, sel]) => {
      const cardDiv = cardsListDiv.querySelector(`.card[data-id="${cardId}"]`);
      if (cardDiv) {
        if (sel) cardDiv.classList.add('selected');
        else     cardDiv.classList.remove('selected');
      }
    });
    updateSelectedCounter();

  }
});


// Dès qu'un joueur change d'équipe, le serveur émet 'update_teams' à toute la room
socket.on('update_teams', ({ team1, team2 }) => {
  renderTeams({ team1, team2 });
});

// ----- Fonctions d’affichage ----- //
function renderTeams({ team1, team2 }) {
  const team1ListDiv = document.getElementById('team1List');
  const team2ListDiv = document.getElementById('team2List');
  // Vider l’existant
  team1ListDiv.innerHTML = '';
  team2ListDiv.innerHTML = '';

  // Afficher tous les joueurs d’équipe 1
  team1.forEach((uname) => {
    const div = document.createElement('div');
    div.textContent = uname;
    div.classList.add('teamMember');
    if (uname === window.currentUsername) {
      div.style.fontWeight = 'bold';
      div.style.color = '#801d1a';
    }
    team1ListDiv.appendChild(div);
  });

  // Afficher tous les joueurs d’équipe 2
  team2.forEach((uname) => {
    const div = document.createElement('div');
    div.textContent = uname;
    div.classList.add('teamMember');
    if (uname === window.currentUsername) {
      div.style.fontWeight = 'bold';
      div.style.color = '#801d1a';
    }
    team2ListDiv.appendChild(div);
  });
}

function renderCardList() {
  cardsListDiv.innerHTML = '';
  seiyuuData.forEach((c) => {
    const cardDiv = document.createElement('div');
    cardDiv.classList.add('card');
    cardDiv.dataset.id = c.id;
    cardDiv.textContent = `${c.name} (${c.gender})`;

    if (selectedMap[c.id]) {
      cardDiv.classList.add('selected');
    }

    // Clic sur une carte → bascule sélection
    cardDiv.addEventListener('click', () => {
      const already = selectedMap[c.id];
      // Si on veut sélectionner plus que totalCardsToSelect → on bloque
      const currentlySelectedCount = Object.values(selectedMap).filter((b) => b).length;
      if (!already && currentlySelectedCount >= totalCardsToSelect) {
        return;
      }

      // Mettre à jour localement
      const newState = !already;
      selectedMap[c.id] = newState;
      if (newState) cardDiv.classList.add('selected');
      else          cardDiv.classList.remove('selected');
      updateSelectedCounter();

      // Émettre au serveur pour synchroniser en temps réel
      socket.emit('toggle_card', {
        roomName: currentRoom,
        cardId: c.id,
        selected: newState
      });
    });

    cardsListDiv.appendChild(cardDiv);
  });

  updateStartButton();
}

// Mettre à jour le compteur "Cartes : X / totalCardsToSelect"
function updateSelectedCounter() {
  const count = Object.values(selectedMap).filter((b) => b).length;
  selectedCounter.textContent = `Cartes : ${count}/${totalCardsToSelect}`;
  updateStartButton();
}

// Activer/Désactiver le bouton "Commencer"
function updateStartButton() {
  const count = Object.values(selectedMap).filter((b) => b).length;
  // Bouton activé seulement si count === totalCardsToSelect
  startGameBtn.disabled = (count !== totalCardsToSelect);
}

// ===== Validation des paramètres (Thème + Nombre de cartes) =====
function updateValidateButton() {
  const val = parseInt(cardsCountInput.value, 10);
  const enabled = !isNaN(val) && val >= 2 && val <= 50 && (val % 2 === 0);
  validateSettingsBtn.disabled = !enabled;
}

cardsCountInput.addEventListener('input', updateValidateButton);

// ----- Gestion des clics sur les titres des équipes ----- //
const team1Header = document.getElementById('team1Header');
const team2Header = document.getElementById('team2Header');

team1Header.addEventListener('click', () => {
  if (!window.currentRoom || !window.currentUsername) {
    return;
  }
  socket.emit('switch_team', {
    roomName: window.currentRoom,
    targetTeam: 1
  });
});

team2Header.addEventListener('click', () => {
  if (!window.currentRoom || !window.currentUsername) {
    return;
  }
  socket.emit('switch_team', {
    roomName: window.currentRoom,
    targetTeam: 2
  });
});

// ===== Écouter la synchronisation depuis le serveur =====

socket.on('enter_card_selection', ({ totalCards, seiyuuList, selectedMap: initialMap }) => {
  settingsBox.style.display   = 'none';
  cardSelectBox.style.display = 'flex';

  totalCardsToSelect = totalCards;
  seiyuuData         = [...seiyuuList];
  selectedMap        = {};

  // Reconstruire selectedMap à partir de initialMap
  seiyuuData.forEach(c => {
    selectedMap[c.id] = initialMap[c.id] === true;
  });

  renderCardList();
  // Appliquer la classe "selected" sur les cartes déjà cochées
  Object.entries(selectedMap).forEach(([cardId, sel]) => {
    const cardDiv = cardsListDiv.querySelector(`.card[data-id="${cardId}"]`);
    if (cardDiv) {
      if (sel) cardDiv.classList.add('selected');
      else     cardDiv.classList.remove('selected');
    }
  });
  updateSelectedCounter();
});

socket.on('update_card_selection', ({ cardId, selected }) => {
  selectedMap[cardId] = selected;
  const cardDiv = cardsListDiv.querySelector(`.card[data-id="${cardId}"]`);
  if (cardDiv) {
    if (selected) cardDiv.classList.add('selected');
    else          cardDiv.classList.remove('selected');
  }
  updateSelectedCounter();
});

// Lorsque le serveur envoie 'enter_settings'
socket.on('enter_settings', ({ totalCards }) => {
  settingsBox.style.display   = 'block';
  cardSelectBox.style.display = 'none';

  // Repositionner le champ Nombre de cartes
  cardsCountInput.value = totalCards;
  totalCardsToSelect = totalCards;
  updateValidateButton();
});

// Lorsqu’on veut tout déselectionner (Retour)
socket.on('clear_all_cards', () => {
  seiyuuData.forEach((c) => {
    selectedMap[c.id] = false;
  });
  // Mettre à jour toutes les cartes visuellement
  cardsListDiv.querySelectorAll('.card').forEach((cardDiv) => {
    cardDiv.classList.remove('selected');
  });
  updateSelectedCounter();
});


// Au clic sur Valider
validateSettingsBtn.addEventListener('click', () => {
  // Lecture des paramètres
  const theme  = themeSelect.value;                      // 'seiyuu'
  const count  = parseInt(cardsCountInput.value, 10);    // e.g. 50
  totalCardsToSelect = count;

  const csvUrl = 'https://docs.google.com/spreadsheets/d/1WFgQpTXZM6H5RzLdZSwu1R2llwM1ZoTx-Z2_TJBdVU4/export?format=csv&gid=0';


  fetch(csvUrl)
    .then(res => {
      if (!res.ok) {
        throw new Error('Impossible de charger le Google Sheet');
      }
      return res.text();
    })
    .then(csvText => {
      const lines = csvText.split('\n');
      const raw = [];
      // Parser ligne par ligne (on ignore la ligne 0 qui est l’en-tête)
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line === '') continue;
        const parts = line.split(',');
        if (parts.length < 4) continue;
        const id    = parts[0].trim();
        const name  = parts[1].trim();
        const gender= parts[2].trim();
        const link  = parts[3].trim();
        if (id === '') continue;
        raw.push({ id, name, gender, link });
      }

      // 2) Dédoublonner par "name" (Seiyuu), choisir aléatoirement un extrait par seiyuu
      const byName = {}; // { name: [ {…}, {…}, … ] }
      raw.forEach(c => {
        if (!byName[c.name]) byName[c.name] = [];
        byName[c.name].push(c);
      });

      const filtered = [];
      Object.values(byName).forEach(arr => {
        // arr est un tableau de tous les objets pour le même seiyuu
        // on en choisit un au hasard
        const choix = arr[Math.floor(Math.random() * arr.length)];
        filtered.push(choix);
      });

      // 3) Trier par ordre alphabétique de "name"
      filtered.sort(sortByName);

      // 4) C’est notre seiyuuData
      seiyuuData = filtered;

      // 5) Construire selectedMap (toutes cochées à false)
      selectedMap = {};
      seiyuuData.forEach(c => {
        selectedMap[c.id] = false;
      });

      // 6) Envoyer la liste au serveur
      socket.emit('validate_settings', {
        roomName: currentRoom,
        totalCards: count,
        seiyuuList: seiyuuData
      });

      // (Ensuite, on attend l’événement 'enter_card_selection')
    })
    .catch(err => {
      console.error('Erreur fetch/parse du CSV :', err);
    });
});

// ===== Boutons 🎲 / ♂ / ♀ =====
// "Retour" : revenir à settingsBox
backBtn.addEventListener('click', () => {
  socket.emit('back_to_settings', { roomName: currentRoom });
});

// 🎲 : sélection aléatoire de "totalCardsToSelect"
randomBtn.addEventListener('click', () => {
  const allIds = seiyuuData.map((c) => c.id);
  const shuffled = allIds.sort(() => 0.5 - Math.random());
  const toSelect = new Set(shuffled.slice(0, totalCardsToSelect));
  seiyuuData.forEach((c) => {
    const shouldBeSelected = toSelect.has(c.id);
    if (selectedMap[c.id] !== shouldBeSelected) {
      selectedMap[c.id] = shouldBeSelected;
      socket.emit('toggle_card', {
        roomName: currentRoom,
        cardId: c.id,
        selected: shouldBeSelected
      });
    }
  });
});

maleBtn.addEventListener('click', () => {
  const maleIds = seiyuuData.filter((c) => c.gender === 'Male').map((c) => c.id);
  let toSelectIds;
  if (maleIds.length <= totalCardsToSelect) {
    toSelectIds = maleIds;
  } else {
    const shuffled = maleIds.sort(() => 0.5 - Math.random());
    toSelectIds = shuffled.slice(0, totalCardsToSelect);
  }
  const toSelectSet = new Set(toSelectIds);

  seiyuuData.forEach((c) => {
    const shouldBeSelected = toSelectSet.has(c.id);
    if (selectedMap[c.id] !== shouldBeSelected) {
      selectedMap[c.id] = shouldBeSelected;
      socket.emit('toggle_card', {
        roomName: currentRoom,
        cardId: c.id,
        selected: shouldBeSelected
      });
    }
  });
});

femaleBtn.addEventListener('click', () => {
  const femaleIds = seiyuuData.filter((c) => c.gender === 'Female').map((c) => c.id);
  let toSelectIds;
  if (femaleIds.length <= totalCardsToSelect) {
    toSelectIds = femaleIds;
  } else {
    const shuffled = femaleIds.sort(() => 0.5 - Math.random());
    toSelectIds = shuffled.slice(0, totalCardsToSelect);
  }
  const toSelectSet = new Set(toSelectIds);

  seiyuuData.forEach((c) => {
    const shouldBeSelected = toSelectSet.has(c.id);
    if (selectedMap[c.id] !== shouldBeSelected) {
      selectedMap[c.id] = shouldBeSelected;
      socket.emit('toggle_card', {
        roomName: currentRoom,
        cardId: c.id,
        selected: shouldBeSelected
      });
    }
  });
});

// ===== Bouton Commencer (pour le test, ne fait rien) =====
startGameBtn.addEventListener('click', () => {
  socket.emit('start_game', { roomName: currentRoom });
});
// public/game.js

// ===== Références DOM =====
const gameDiv       = document.getElementById('game');
const oppReadyBar   = document.getElementById('oppReadyBar');
const ownReadyBar   = document.getElementById('ownReadyBar');
const opponentField = document.getElementById('opponentField');
const ownField      = document.getElementById('ownField');

let windowCurrentRoom = null;
let windowMyTeam      = null; // 1 ou 2, fourni par join_success
let gameState         = null; // { team1: [...], team2: [...], ready: { team1, team2 } }
let inActionPhase = false;
let waitingForTransfer = false;
let transferPhase = false;
let transferTeam = null;


// ==============================
// 1) LISTENER : “join_success” (pour récupérer yourTeam)
// ==============================
socket.on('join_success', ({ roomName, teams, yourTeam, state }) => {
  windowCurrentRoom = roomName;
  windowMyTeam      = yourTeam;

  renderTeams(teams);
  
  // Si on arrive en cours de partie (state === 'in_game'), on attend game_started
  if (state === 'in_game') {
    // masquer prégame, ne rien afficher pour l'instant
    document.getElementById('settingsBox').style.display   = 'none';
    document.getElementById('cardSelectBox').style.display = 'none';
    gameDiv.style.display = 'none';
  }
});

socket.on('update_teams', ({ team1, team2 }) => {
  renderTeams({ team1, team2 });
  // Si mon pseudo (window.currentUsername) se trouve dans team1 ou team2,
  // on met à jour windowMyTeam en conséquence.
  const uname = window.currentUsername;
  if (team1.includes(uname)) {
    windowMyTeam = 1;
  } else if (team2.includes(uname)) {
    windowMyTeam = 2;
  }
  if (gameState) {
    placeAllCards();
  }
  // (On peut aussi rappeler renderTeams si besoin, mais ce n’est pas ici impératif.)
});


// ==============================
// 2) LISTENER : “game_started”
// ==============================
socket.on('game_started', ({ gameState: gs }) => {
  gameState = gs; // { team1: [...], team2: [...], ready: { team1, team2 } }

  // Masquer tout le conteneur prégame
  document.getElementById('pregame').style.display      = 'none';
  // Masquer les sous‐boîtes (au cas où)
  document.getElementById('settingsBox').style.display   = 'none';
  document.getElementById('cardSelectBox').style.display = 'none';
  // Afficher enfin la zone de jeu
  gameDiv.style.display = 'block';

  // Construire le terrain (30 slots) pour chaque équipe
  buildEmptyField(opponentField);
  buildEmptyField(ownField);

  // Placer toutes les cartes aux bonnes positions
  placeAllCards();

  // Mettre à jour les ready bars selon gameState.ready
  updateReadyBars();
});

// ==============================
// 3) LISTENER : “card_moved”
// ==============================
socket.on('card_moved', ({ team, fromPos, toPos }) => {
  if (!gameState) return;
  const arr = (team === 1) ? gameState.team1 : gameState.team2;

  // Trouver la carte à fromPos
  const idxFrom = arr.findIndex(c => c.position === fromPos);
  if (idxFrom === -1) return;

  // Voir s’il y a une carte déjà à toPos
  const idxTo = arr.findIndex(c => c.position === toPos);
  if (idxTo !== -1) {
    // Échanger les positions
    const tmp = arr[idxFrom].position;
    arr[idxFrom].position = arr[idxTo].position;
    arr[idxTo].position   = tmp;
  } else {
    // Déplacer simplement
    arr[idxFrom].position = toPos;
  }

  // Replacer visuellement toutes les cartes
  placeAllCards();
});

// ==============================
// 4) LISTENER : “team_ready”
// ==============================
socket.on('team_ready', ({ team, ready }) => {
  if (!gameState) return;
  gameState.ready[`team${team}`] = ready;
  updateReadyBars();
});

// ==============================
// LISTENER : “action_started” (serveur envoie l’extrait à jouer)
// Payload : { link, cardId, correctTeam }
// ==============================
socket.on('action_started', ({ link, cardId, correctTeam }) => {
  // 1) On passe en phase action : plus de déplacements
  inActionPhase = true;
  waitingForTransfer = false;
  transferTeam = null;
  updateReadyBars();

  // 2) Charger l’audio (on suppose qu’il y a un <audio id="audioPlayer"> quelque part dans le HTML)
  const audio = document.getElementById('audioPlayer');
  if (!audio) {
    // Si besoin, on crée dynamiquement
    const a = document.createElement('audio');
    a.id = 'audioPlayer';
    document.body.appendChild(a);
  }
  const player = document.getElementById('audioPlayer');
  player.src = link;
  player.load();

  // 3) Pour essayer de synchroniser, on attend que l’élément puisse jouer : 
  player.oncanplay = () => {
    player.play();
  };

  // 4) Dès que l’audio est lancé, on veut interdire tout déplacement de carte :
  player.onplay = () => {
    // (le flag inActionPhase suffit, les listeners de buildEmptyField vérifieront ce flag pour interdire)
  };
});

/**
 * 1) Dès que le serveur nous dit qu'une carte a été cliquée en premier,
 *    on applique localement le fond semi‐transparent rouge (team1) ou violet (team2)
 *    sur TOUS les clients, pour la carte donnée.
 */
socket.on('card_clicked', ({ cardId, team: clickTeam }) => {
  // 1) D'abord, on cherche la carte dans notre propre terrain :
  let slot = ownField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
  if (slot) {
    const parentSlot = slot.parentElement;
    // Couleur rouge si clickTeam===1, violet sinon
    parentSlot.style.backgroundColor =
      clickTeam === 1
        ? 'rgba(255, 0, 0, 0.3)'
        : 'rgba(128, 0, 128, 0.3)';
    return;
  }

  // 2) Sinon, on la cherche dans le terrain adverse :
  slot = opponentField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
  if (slot) {
    const parentSlot = slot.parentElement;
    parentSlot.style.backgroundColor =
      clickTeam === 1
        ? 'rgba(255, 0, 0, 0.3)'
        : 'rgba(128, 0, 128, 0.3)';
  }
});

/**
 * 2) Dès que le serveur envoie “reveal_card” (après 2 s ou 15 s),
 *    on marque la carte correcte en vert semi‐transparent (puis elle sera supprimée).
 */
socket.on('reveal_card', ({ cardId }) => {
  // On trouve d’abord dans notre propre équipe (ownField)
  let slot = ownField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
  if (slot) {
    slot.parentElement.style.transition = 'background-color 0.5s ease';
    slot.parentElement.style.backgroundColor = 'rgba(0, 255, 0, 0.3)';
    return;
  }
  // Sinon, c’est chez l’adversaire
  slot = opponentField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
  if (slot) {
    slot.parentElement.style.transition = 'background-color 0.5s ease';
    slot.parentElement.style.backgroundColor = 'rgba(0, 255, 0, 0.3)';
  }
});

/**
 * 3) Dès que le serveur envoie “remove_card”, on retire la carte du plateau
 */
socket.on('remove_card', ({ cardId }) => {
  // Retirer la <div class="cardName"> et la classe "filled" du slot
  const slotOwn = ownField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
  if (slotOwn) {
    const parentSlot = slotOwn.parentElement;
    parentSlot.classList.remove('filled');
    parentSlot.style.backgroundColor = '';
    parentSlot.innerHTML = '';
  } else {
    const slotOpp = opponentField.querySelector(`.slot .cardName[data-id="${cardId}"]`);
    if (slotOpp) {
      const parentSlot = slotOpp.parentElement;
      parentSlot.classList.remove('filled');
      parentSlot.style.backgroundColor = '';
      parentSlot.innerHTML = '';
    }
  }

  // 2) Enlever la carte de gameState pour qu'elle ne réapparaisse plus lors d'un placeAllCards()
  if (gameState) {
    gameState.team1 = gameState.team1.filter(c => c.id !== cardId);
    gameState.team2 = gameState.team2.filter(c => c.id !== cardId);
  }
});

/**
 * 10) PHASE DE TRANSFERT : lorsque le serveur demande à une équipe de choisir une carte à donner
 *    Payload: { winningTeam } ; winningTeam = 1 ou 2
 */
socket.on('prompt_card_transfer', ({ winningTeam }) => {
  // Si ce n'est pas notre équipe, on ignore
  if (windowMyTeam !== winningTeam) {
    transferPhase = true;
    const msgDiv = document.getElementById('transferMessage');
    msgDiv.textContent = 'Attente du choix adverse ...';
    msgDiv.style.display = 'block';
    return;
  }

  transferTeam = winningTeam;
  waitingForTransfer = true;

  // Afficher un message (préalablement, ajoutez dans votre HTML un <div id="transferMessage"></div>)
  const msgDiv = document.getElementById('transferMessage');
  msgDiv.textContent = 'Choisissez une carte à donner à l’adversaire';
  msgDiv.style.display = 'block';
});

// 11) CARTE TRANSFÉRÉE
socket.on('card_transferred', ({ card, newTeam }) => {
  // Retirer d'abord (normalement déjà fait par remove_card), puis réinsérer au bon endroit
  if (newTeam === windowMyTeam) {
    insertCardIntoSlot(ownField, card.position, card.name, card.id);
  } else {
    insertCardIntoSlot(opponentField, card.position, card.name, card.id);
  }

  // Cacher le message de transfert
  const msgDiv = document.getElementById('transferMessage');
  msgDiv.style.display = 'none';

  // Repasser en phase préparation
  goToPreparationPhase();
});

// 12) FIN DE LA PHASE ACTION (aucun transfert nécessaire)
socket.on('action_phase_over', ({ team1, team2 }) => {
  // Mettre à jour l’état local des équipes
  gameState.team1 = team1.map(c => ({ ...c }));
  gameState.team2 = team2.map(c => ({ ...c }));

  // Rebuild + replacer toutes les cartes
  buildEmptyField(opponentField);
  buildEmptyField(ownField);
  placeAllCards();

  // Repasser en phase préparation
  goToPreparationPhase();
});

socket.on('match_over', ({ winningTeam, players }) => {
  // masquer la zone de jeu
  gameDiv.style.display = 'none';

  // afficher l’écran de fin
  const box   = document.getElementById('matchOver');
  const title = document.getElementById('winnerTitle');
  const list  = document.getElementById('winnerPlayers');

  box.style.display   = 'flex';
  title.textContent = `Victoire de l’équipe ${winningTeam} !`;
  list.textContent  = players.join(', ');

  setTimeout(() => {
    // Après 10 secondes, on cache l’écran de fin
    box.style.display = 'none';
    // On remet le jeu en mode prégame
    document.getElementById('pregame').style.display = 'block';

  }, 10000);
  // on laisse le serveur nous renvoyer 'enter_settings' 10 s plus tard ;
  // le listener existant dans pregame.js se chargera du reset d’UI
});

// ==============================
// 5) FONCTION : construire 30 slots dans un conteneur
// ==============================
function buildEmptyField(container) {
  container.innerHTML = '';
  for (let i = 0; i < 30; i++) {
    const slot = document.createElement('div');
    slot.classList.add('slot');
    slot.dataset.pos = i;

    // Clic sur une slot pour déplacer une carte (si c’est mon propre terrain)
    slot.addEventListener('click', () => {
      if (!gameState) return;
      if (inActionPhase) return;
      if (transferPhase) return;
      // Si on clique dans le terrain adverse, on n’autorise pas
      if (container === opponentField) return;

      const myTeam = windowMyTeam;
      const arr    = (myTeam === 1) ? gameState.team1 : gameState.team2;
      const clickedPos = parseInt(slot.dataset.pos, 10);

      // Recherche d’une slot déjà “sélectionnée” (avec class selected-slot)
      const prev = document.querySelector('.slot.selected-slot');
      if (!prev) {
        // Première étape : on marque “fromPos” si une carte est présente
        const idxFrom = arr.findIndex(c => c.position === clickedPos);
        if (idxFrom !== -1) {
          prev && prev.classList.remove('selected-slot');
          slot.classList.add('selected-slot');
        }
        return;
      } else {
        // Deuxième étape : on a un “fromPos” déjà marqué
        const fromSlot = prev;
        const fromPos = parseInt(fromSlot.dataset.pos, 10);
        const toPos   = clickedPos;
        fromSlot.classList.remove('selected-slot');

        // On envoie l’événement au serveur
        socket.emit('move_card', {
          roomName: windowCurrentRoom,
          team: myTeam,
          fromPos,
          toPos
        });
      }
    });

    container.appendChild(slot);
  }
}

// ==============================
// 6) FONCTION : placer toutes les cartes dans les slots
// ==============================
function placeAllCards() {
  // Vider le contenu des slots sans remplacer les éléments (on garde les listeners de buildEmptyField)
  opponentField.querySelectorAll('.slot').forEach(s => {
    s.innerHTML = '';
    s.classList.remove('filled');
    s.style.backgroundColor = '';
  });
  ownField.querySelectorAll('.slot').forEach(s => {
    s.innerHTML = '';
    s.classList.remove('filled');
    s.style.backgroundColor = '';
  });

  // Parcourir les cartes de team1
  gameState.team1.forEach(card => {
    const { id, name, position } = card;
    if (windowMyTeam === 1) {
      insertCardIntoSlot(ownField, position, name, id);
    } else {
      insertCardIntoSlot(opponentField, position, name, id);
    }
  });

  // Parcourir les cartes de team2
  gameState.team2.forEach(card => {
    const { id, name, position } = card;
    if (windowMyTeam === 2) {
      insertCardIntoSlot(ownField, position, name, id);
    } else {
      insertCardIntoSlot(opponentField, position, name, id);
    }
  });
}

// ==============================
// 7) FONCTION : injecter le nom d’une carte dans une slot
// ==============================
function insertCardIntoSlot(container, pos, name, id) {
  const slot = container.querySelector(`.slot[data-pos="${pos}"]`);
  if (!slot) return;

  // Injecter le nom de la carte
  slot.innerHTML = `<div class="cardName" data-id="${id}">${name}</div>`;
  slot.classList.add('filled');

  // --- FIX: Remove previous card click listener if any ---
  if (slot._cardClickListener) {
    slot.removeEventListener('click', slot._cardClickListener);
  }

  // Define the new click listener
  const cardClickListener = () => {
    // 1) Si on est en attente de transfert
    if (waitingForTransfer) {
      if (container === ownField && windowMyTeam === transferTeam) {
        waitingForTransfer = false; // une seule sélection autorisée
        socket.emit('transfer_card', {
          roomName: windowCurrentRoom,
          cardId: id,
          team: windowMyTeam
        });
      }
      return;
    }

    // 2) Si on n'est pas en phase action, on ignore le clic
    if (!inActionPhase) return;

    // 3) On est en phase action : c’est le premier clic “karuta”
    socket.emit('card_response', {
      roomName: windowCurrentRoom,
      cardId: id,
      username: window.currentUsername,
      team: windowMyTeam
    });
  };

  // Attach and store the listener
  slot.addEventListener('click', cardClickListener);
  slot._cardClickListener = cardClickListener;
}

// ==============================
// 8) GESTION DU “READY” (barres cliquables)
// ==============================
ownReadyBar.addEventListener('click', () => {
  if (!gameState) return;
  if (inActionPhase) return;
  if (waitingForTransfer) return;
  const myTeam = windowMyTeam;
  socket.emit('player_ready', {
    roomName: windowCurrentRoom,
    team: myTeam
  });
});

function updateReadyBars() {
  const myTeam  = windowMyTeam;
  const oppTeam = myTeam === 1 ? 2 : 1;
  const isMyReady  = gameState.ready[`team${myTeam}`];
  const isOppReady = gameState.ready[`team${oppTeam}`];

  ownReadyBar.textContent = isMyReady ? 'Prêt' : 'Mettez-vous prêt';
  ownReadyBar.style.backgroundColor = isMyReady ? 'rgb(104, 206, 115)' : 'rgb(255, 148, 148)';

  oppReadyBar.textContent = isOppReady ? 'Prêt' : "En attente de l'adversaire";
  oppReadyBar.style.backgroundColor = isOppReady ? 'rgb(104, 206, 115)' : 'rgb(255, 148, 148)';

  // La barre adverse n’est pas cliquable (le clic sert uniquement à mon équipe)
  oppReadyBar.style.cursor = 'default';
}

// ==============================
// 9) Écouteur au cas où un nouveau joueur rejoint en cours de partie
// ==============================
socket.on('join_success', ({ state, seiyuuList, totalCards, selectedMap }) => {
  if (state === 'in_game') {
    // On attend “game_started” pour afficher la partie
    document.getElementById('settingsBox').style.display   = 'none';
    document.getElementById('cardSelectBox').style.display = 'none';
    gameDiv.style.display = 'none';
  }
});

/**
 * Revenir en mode "préparation" :
 * - inActionPhase = false (on réautorise déplacement)
 * - Afficher les ready-bars “Mettez-vous prêts”
 * - Réinitialiser le flag waitingForTransfer
 */
function goToPreparationPhase() {
  inActionPhase = false;
  waitingForTransfer = false;
  transferPhase = false;
  transferTeam = null;

  const player = document.getElementById('audioPlayer');
  if (player) {
    player.pause();
  }


  // Montrer les ready-bars (maTeam + adversaire) pour la préparation
  ownReadyBar.textContent = 'Mettez-vous prêt';
  ownReadyBar.style.backgroundColor = 'rgb(255, 148, 148)';
  ownReadyBar.style.cursor = 'pointer';

  oppReadyBar.textContent = "En attente de l'adversaire";
  oppReadyBar.style.backgroundColor = 'rgb(255, 148, 148)';
  oppReadyBar.style.cursor = 'default';

}
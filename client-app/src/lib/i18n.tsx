import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type AppLocale = 'pt-BR' | 'en-US' | 'es-ES' | 'fr-FR';

type Copy = Record<AppLocale, string>;

const STORAGE_KEY = 'condoos_locale';

export const LOCALE_OPTIONS: Array<{ locale: AppLocale; label: string; short: string }> = [
  { locale: 'pt-BR', label: 'Português', short: 'PT' },
  { locale: 'en-US', label: 'English', short: 'EN' },
  { locale: 'es-ES', label: 'Español', short: 'ES' },
  { locale: 'fr-FR', label: 'Français', short: 'FR' },
];

function normalize(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function detectLocale(): AppLocale {
  const stored = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
  if (stored && isAppLocale(stored)) return stored;

  const languages = typeof navigator !== 'undefined' && navigator.languages?.length
    ? navigator.languages
    : [typeof navigator !== 'undefined' ? navigator.language : 'pt-BR'];

  for (const raw of languages) {
    const lang = raw.toLowerCase();
    if (lang.startsWith('pt')) return 'pt-BR';
    if (lang.startsWith('es')) return 'es-ES';
    if (lang.startsWith('fr')) return 'fr-FR';
    if (lang.startsWith('en')) return 'en-US';
  }
  return 'en-US';
}

function isAppLocale(value: string): value is AppLocale {
  return value === 'pt-BR' || value === 'en-US' || value === 'es-ES' || value === 'fr-FR';
}

const phrases: Copy[] = [
  c('Carregando...', 'Loading...', 'Cargando...', 'Chargement...'),
  c('Loading...', 'Loading...', 'Cargando...', 'Chargement...'),
  c('Fechar menu', 'Close menu', 'Cerrar menú', 'Fermer le menu'),
  c('Abrir menu', 'Open menu', 'Abrir menú', 'Ouvrir le menu'),
  c('Sair', 'Sign out', 'Cerrar sesión', 'Se déconnecter'),
  c('Morador', 'Resident', 'Residente', 'Résident'),
  c('Síndico', 'Board admin', 'Administrador', 'Syndic'),
  c('Unit', 'Unit', 'Unidad', 'Lot'),
  c('Apto', 'Unit', 'Unidad', 'Lot'),

  // Global navigation
  c('Início', 'Overview', 'Inicio', 'Accueil'),
  c('Visão geral', 'Overview', 'Resumen', 'Vue d’ensemble'),
  c('Encomendas', 'Packages', 'Paquetes', 'Colis'),
  c('Visitantes', 'Visitors', 'Visitantes', 'Visiteurs'),
  c('Áreas comuns', 'Amenities', 'Áreas comunes', 'Espaces communs'),
  c('Comunicados', 'Announcements', 'Avisos', 'Annonces'),
  c('Propostas', 'Proposals', 'Propuestas', 'Propositions'),
  c('Assembleias', 'Assemblies', 'Asambleas', 'Assemblées'),
  c('Reuniões', 'Meetings', 'Reuniones', 'Réunions'),
  c('Sugerir', 'Suggest', 'Sugerir', 'Suggérer'),
  c('Preferências', 'Settings', 'Preferencias', 'Préférences'),
  c('Sugestões', 'Suggestions', 'Sugerencias', 'Suggestions'),
  c('Pendentes', 'Pending', 'Pendientes', 'En attente'),
  c('Moradores', 'Residents', 'Residentes', 'Résidents'),
  c('Funcionalidades', 'Features', 'Funciones', 'Fonctionnalités'),
  c('Como funciona', 'How it works', 'Cómo funciona', 'Fonctionnement'),
  c('Dúvidas', 'FAQ', 'Preguntas', 'FAQ'),
  c('Entrar', 'Sign in', 'Entrar', 'Connexion'),
  c('Testar a demo', 'Try the demo', 'Probar la demo', 'Essayer la démo'),
  c('Ver por dentro', 'See inside', 'Ver por dentro', 'Voir l’intérieur'),

  // Login
  c('Sou síndico', 'I am the board admin', 'Soy administrador', 'Je suis syndic'),
  c('Tenho um código', 'I have a code', 'Tengo un código', 'J’ai un code'),
  c('Vamos montar seu prédio', 'Let’s set up your building', 'Vamos a configurar tu edificio', 'Configurons votre immeuble'),
  c('Entre com o Google e em poucos cliques seu condomínio está no ar — com código de convite pronto pros moradores.', 'Sign in with Google and your condo is live in a few clicks — with an invite code ready for residents.', 'Entra con Google y tu condominio estará listo en pocos clics, con código de invitación para residentes.', 'Connectez-vous avec Google et votre copropriété est prête en quelques clics, avec un code d’invitation pour les résidents.'),
  c('Entrar no seu prédio', 'Join your building', 'Entrar a tu edificio', 'Rejoindre votre immeuble'),
  c('Faça login com Google. Em seguida, você insere o código que o síndico mandou e escolhe sua unidade.', 'Sign in with Google. Then enter the code from your board admin and choose your unit.', 'Inicia sesión con Google. Luego ingresa el código del administrador y elige tu unidad.', 'Connectez-vous avec Google. Entrez ensuite le code du syndic et choisissez votre lot.'),
  c('Explorar o CondoOS', 'Explore CondoOS', 'Explorar CondoOS', 'Explorer CondoOS'),
  c('Use uma das contas de demo abaixo para ver o sistema por dentro — síndico ou morador.', 'Use one of the demo accounts below to see the system from the inside — board admin or resident.', 'Usa una de las cuentas demo abajo para ver el sistema por dentro: administrador o residente.', 'Utilisez l’un des comptes démo ci-dessous pour voir le système de l’intérieur : syndic ou résident.'),
  c('Um lugar tranquilo para o prédio pensar.', 'A calm, soft place for a building to think.', 'Un lugar tranquilo para que el edificio piense.', 'Un espace calme pour qu’un immeuble réfléchisse.'),
  c('Entre com Google, com uma conta demo ou manualmente. Sem cartão, sem setup.', 'Sign in with Google, a demo account, or manually. No card, no setup.', 'Entra con Google, una cuenta demo o manualmente. Sin tarjeta, sin configuración.', 'Connectez-vous avec Google, un compte démo ou manuellement. Pas de carte, pas de configuration.'),
  c('Entre com Google ou com as credenciais que o seu prédio te forneceu.', 'Sign in with Google or with the credentials your building provided.', 'Entra con Google o con las credenciales que te dio tu edificio.', 'Connectez-vous avec Google ou avec les identifiants fournis par votre immeuble.'),
  c('com IA', 'AI-powered', 'con IA', 'propulsé par IA'),
  c('Bem-vindo de volta', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'),
  c('Entre no seu prédio.', 'Sign in to your building.', 'Entra a tu edificio.', 'Connectez-vous à votre immeuble.'),
  c('Demo com 1 clique', 'One-click demo', 'Demo en un clic', 'Démo en un clic'),
  c('ou entre com', 'or continue with', 'o continúa con', 'ou continuer avec'),
  c('ou manualmente', 'or manually', 'o manualmente', 'ou manuellement'),
  c('voce@predio.com.br', 'you@building.dev', 'tu@edificio.dev', 'vous@immeuble.dev'),
  c('senha', 'password', 'contraseña', 'mot de passe'),
  c('Email ou senha incorretos', 'Invalid email or password', 'Email o contraseña incorrectos', 'E-mail ou mot de passe incorrect'),
  c('Falha ao entrar', 'Sign in failed', 'Error al entrar', 'Échec de la connexion'),
  c('Nenhuma credencial do Google recebida', 'No Google credential received', 'No se recibió credencial de Google', 'Aucun identifiant Google reçu'),
  c('Falha ao entrar com Google', 'Google sign-in failed', 'Error con Google', 'Échec de la connexion Google'),
  c('Login com Google cancelado', 'Google sign-in was cancelled', 'Inicio con Google cancelado', 'Connexion Google annulée'),
  c('Código detectado:', 'Code detected:', 'Código detectado:', 'Code détecté :'),
  c('A calm, soft place for a building to think.', 'A calm, soft place for a building to think.', 'Un lugar tranquilo para que el edificio piense.', 'Un espace calme pour qu’un immeuble réfléchisse.'),
  c('Sign in with a demo account, Google, or manually. No account needed for the demo.', 'Sign in with a demo account, Google, or manually. No account needed for the demo.', 'Entra con una cuenta demo, Google o manualmente. No necesitas cuenta para la demo.', 'Connectez-vous avec un compte démo, Google ou manuellement. Aucun compte requis pour la démo.'),
  c('Sign in with Google or your building credentials.', 'Sign in with Google or your building credentials.', 'Entra con Google o con las credenciales de tu edificio.', 'Connectez-vous avec Google ou vos identifiants d’immeuble.'),
  c('claymorphism', 'claymorphism', 'claymorphism', 'claymorphism'),
  c('glassmorphism', 'glassmorphism', 'glassmorphism', 'glassmorphism'),
  c('AI-powered', 'AI-powered', 'con IA', 'propulsé par IA'),
  c('Welcome back', 'Welcome back', 'Bienvenido de vuelta', 'Bon retour'),
  c('Sign in to your building.', 'Sign in to your building.', 'Entra a tu edificio.', 'Connectez-vous à votre immeuble.'),
  c('One-click demo', 'One-click demo', 'Demo en un clic', 'Démo en un clic'),
  c('Board admin', 'Board admin', 'Administrador', 'Syndic'),
  c('Resident', 'Resident', 'Residente', 'Résident'),
  c('or continue with', 'or continue with', 'o continúa con', 'ou continuer avec'),
  c('or manually', 'or manually', 'o manualmente', 'ou manuellement'),
  c('password', 'password', 'contraseña', 'mot de passe'),
  c('Sign in', 'Sign in', 'Entrar', 'Connexion'),
  c('Invalid credentials', 'Invalid credentials', 'Credenciales inválidas', 'Identifiants invalides'),
  c('Sign in failed', 'Sign in failed', 'Error al entrar', 'Échec de la connexion'),
  c('Login failed', 'Login failed', 'Error al entrar', 'Échec de la connexion'),
  c('No Google credential received', 'No Google credential received', 'No se recibió credencial de Google', 'Aucun identifiant Google reçu'),
  c('Google sign-in failed', 'Google sign-in failed', 'Error con Google', 'Échec de la connexion Google'),
  c('Google sign-in was cancelled', 'Google sign-in was cancelled', 'Inicio con Google cancelado', 'Connexion Google annulée'),

  // Landing
  c('Acesso antecipado · Para condomínios brasileiros', 'Early access · For modern condos', 'Acceso anticipado · Para condominios modernos', 'Accès anticipé · Pour copropriétés modernes'),
  c('Seu condomínio,', 'Your condo,', 'Tu condominio,', 'Votre copropriété,'),
  c('em paz.', 'at peace.', 'en paz.', 'en paix.'),
  c('Encomendas, visitantes, áreas comuns, votação — e uma IA que transforma reclamações em propostas prontas pra pauta e atas em linguagem humana.', 'Packages, visitors, amenities, voting — and AI that turns complaints into agenda-ready proposals and minutes into plain language.', 'Paquetes, visitantes, áreas comunes, votaciones — e IA que convierte quejas en propuestas listas para agenda y actas claras.', 'Colis, visiteurs, espaces communs, votes — et une IA qui transforme les plaintes en propositions prêtes pour l’ordre du jour et les procès-verbaux en langage clair.'),
  c('2 encomendas', '2 packages', '2 paquetes', '2 colis'),
  c('Votação passando', 'Vote passing', 'Votación aprobándose', 'Vote en passe d’être adopté'),
  c('Trocar ar do saguão · 4-1', 'Replace lobby AC · 4-1', 'Cambiar el aire del vestíbulo · 4-1', 'Remplacer la clim du hall · 4-1'),
  c('IA redigiu', 'AI drafted', 'IA redactó', 'IA rédigée'),
  c('3 novas propostas', '3 new proposals', '3 propuestas nuevas', '3 nouvelles propositions'),
  c('Talvez a gente procure nos galhos o que só se encontra nas raízes.', 'Maybe we look in the branches for what can only be found in the roots.', 'Quizá buscamos en las ramas lo que solo se encuentra en las raíces.', 'Peut-être cherchons-nous dans les branches ce qui ne se trouve que dans les racines.'),
  c('um jeito mais calmo de cuidar do prédio', 'a calmer way to run the building', 'una forma más tranquila de cuidar el edificio', 'une manière plus calme de gérer l’immeuble'),
  c('tudo em um sistema', 'everything in one system', 'todo en un sistema', 'tout dans un seul système'),
  c('Tudo que o prédio precisa para rodar.', 'Everything the building needs to run.', 'Todo lo que el edificio necesita para funcionar.', 'Tout ce dont l’immeuble a besoin pour tourner.'),
  c('Troque planilhas, grupos de WhatsApp e avisos em papel por um único sistema tranquilo.', 'Replace spreadsheets, WhatsApp groups, and paper notices with one calm system.', 'Reemplaza planillas, grupos de WhatsApp y avisos en papel por un sistema tranquilo.', 'Remplacez les tableurs, groupes WhatsApp et affiches papier par un système apaisé.'),
  c('Encomendas & visitantes', 'Packages & visitors', 'Paquetes y visitantes', 'Colis et visiteurs'),
  c('Fila da portaria em tempo real. Aprove visita pelo celular.', 'Real-time front desk queue. Approve visitors from your phone.', 'Cola de recepción en tiempo real. Aprueba visitas desde el celular.', 'File de conciergerie en temps réel. Validez les visiteurs depuis le mobile.'),
  c('Áreas comuns & reservas', 'Amenities & bookings', 'Áreas comunes y reservas', 'Espaces communs et réservations'),
  c('Piscina, academia, salão. Morador reserva. Sem conflito.', 'Pool, gym, party room. Residents book without conflicts.', 'Piscina, gimnasio, salón. Reservas sin conflictos.', 'Piscine, salle de sport, salle commune. Réservations sans conflit.'),
  c('Propostas & votação', 'Proposals & voting', 'Propuestas y votación', 'Propositions et votes'),
  c('Reclamação vira decisão. Contagem ao vivo. Transparência total.', 'Complaints become decisions. Live tally. Full transparency.', 'Las quejas se vuelven decisiones. Conteo en vivo. Transparencia total.', 'Les plaintes deviennent décisions. Décompte en direct. Transparence totale.'),
  c('Copiloto IA', 'AI copilot', 'Copiloto IA', 'Copilote IA'),
  c('Compliance brasileira', 'Brazilian compliance', 'Cumplimiento brasileño', 'Conformité brésilienne'),
  c('Ata gerada pela IA.', 'AI-generated minutes.', 'Acta generada por IA.', 'Procès-verbal généré par IA.'),
  c('Quórum atingido', 'Quorum reached', 'Quórum alcanzado', 'Quorum atteint'),
  c('12 de 16 presentes', '12 of 16 present', '12 de 16 presentes', '12 sur 16 présents'),
  c('Para cada morador', 'For every resident', 'Para cada residente', 'Pour chaque résident'),
  c('Fonte grande, contraste alto', 'Large type, high contrast', 'Letra grande, alto contraste', 'Grande police, fort contraste'),
  c('Notificação no WhatsApp', 'WhatsApp notifications', 'Notificaciones por WhatsApp', 'Notifications WhatsApp'),
  c('Explicação em linguagem humana', 'Plain-language explanation', 'Explicación en lenguaje claro', 'Explication en langage clair'),
  c('Votação aberta', 'Voting open', 'Votación abierta', 'Vote ouvert'),
  c('Votação no bolso', 'Voting in your pocket', 'Votación en tu bolsillo', 'Vote dans la poche'),
  c('Portaria', 'Front desk', 'Portería', 'Conciergerie'),
  c('WhatsApp', 'WhatsApp', 'WhatsApp', 'WhatsApp'),
  c('Ver código no GitHub', 'View code on GitHub', 'Ver código en GitHub', 'Voir le code sur GitHub'),
  c('Login com Google', 'Google login', 'Login con Google', 'Connexion Google'),
  c('Dados seus ficam seus', 'Your data stays yours', 'Tus datos siguen siendo tuyos', 'Vos données restent à vous'),
  c('Sem cartão de crédito no beta', 'No credit card in beta', 'Sin tarjeta durante la beta', 'Pas de carte bancaire en bêta'),
  c('feito em hackathon, desenhado para humanos', 'built in a hackathon, designed for humans', 'hecho en hackathon, diseñado para humanos', 'créé en hackathon, conçu pour les humains'),

  // Resident app
  c('Tudo aguardando você na portaria.', 'Everything waiting for you at the front desk.', 'Todo esperando por ti en portería.', 'Tout ce qui vous attend à la conciergerie.'),
  c('Nenhuma encomenda ainda', 'No packages yet', 'Aún no hay paquetes', 'Aucun colis pour le moment'),
  c('As entregas aparecem aqui no momento que chegam.', 'Deliveries appear here as soon as they arrive.', 'Las entregas aparecen aquí al llegar.', 'Les livraisons apparaissent ici dès leur arrivée.'),
  c('Aguardando retirada', 'Waiting for pickup', 'Esperando retiro', 'En attente de retrait'),
  c('aguardando', 'waiting', 'esperando', 'en attente'),
  c('Marcar retirada', 'Mark picked up', 'Marcar retirado', 'Marquer comme retiré'),
  c('Retiradas recentes', 'Recent pickups', 'Retiros recientes', 'Retraits récents'),
  c('Visitantes', 'Visitors', 'Visitantes', 'Visiteurs'),
  c('Avise sobre visitas, entregas ou serviços. A portaria recebe na hora.', 'Notify visitors, deliveries, or services. The front desk gets it immediately.', 'Avisa sobre visitas, entregas o servicios. Portería lo recibe al instante.', 'Prévenez pour les visiteurs, livraisons ou services. La conciergerie le reçoit immédiatement.'),
  c('Novo visitante', 'New visitor', 'Nuevo visitante', 'Nouveau visiteur'),
  c('Cancelar', 'Cancel', 'Cancelar', 'Annuler'),
  c('Nome do visitante', 'Visitor name', 'Nombre del visitante', 'Nom du visiteur'),
  c('Visita', 'Guest', 'Visita', 'Invité'),
  c('Entrega', 'Delivery', 'Entrega', 'Livraison'),
  c('Serviço', 'Service', 'Servicio', 'Service'),
  c('Aplicativo', 'Rideshare', 'App de transporte', 'VTC'),
  c('Observações (opcional)', 'Notes (optional)', 'Notas (opcional)', 'Notes (facultatif)'),
  c('Enviar solicitação', 'Send request', 'Enviar solicitud', 'Envoyer la demande'),
  c('Nenhum visitante registrado', 'No visitors registered', 'Ningún visitante registrado', 'Aucun visiteur enregistré'),
  c('Avise antes para a portaria estar preparada.', 'Notify ahead so the front desk is prepared.', 'Avisa antes para que portería se prepare.', 'Prévenez à l’avance pour préparer la conciergerie.'),
  c('Adicionar visitante', 'Add visitor', 'Agregar visitante', 'Ajouter un visiteur'),
  c('Confirmar reserva', 'Confirm booking', 'Confirmar reserva', 'Confirmer la réservation'),
  c('Próximas reservas', 'Upcoming bookings', 'Próximas reservas', 'Réservations à venir'),
  c('Nenhuma reserva futura no prédio.', 'No upcoming building bookings.', 'No hay reservas futuras.', 'Aucune réservation à venir.'),
  c('Você', 'You', 'Tú', 'Vous'),
  c('You', 'You', 'Tú', 'Vous'),
  c('Nenhuma assembleia agendada.', 'No assemblies scheduled.', 'No hay asambleas programadas.', 'Aucune assemblée planifiée.'),
  c('Redigido pela IA', 'AI-drafted', 'Redactado por IA', 'Rédigé par IA'),
  c('modo offline', 'offline mode', 'modo offline', 'mode hors ligne'),
  c('O que tá pegando?', 'What is going on?', '¿Qué está pasando?', 'Que se passe-t-il ?'),
  c('Pode ser informal. Escreva como falaria com um vizinho.', 'Informal is fine. Write like you would text a neighbor.', 'Puede ser informal. Escribe como hablarías con un vecino.', 'Vous pouvez être informel. Écrivez comme à un voisin.'),
  c('IA redigindo...', 'AI is drafting...', 'La IA está redactando...', 'L’IA rédige...'),
  c('Enviar', 'Submit', 'Enviar', 'Envoyer'),
  c('A IA está transformando sua ideia em uma proposta estruturada...', 'AI is turning your idea into a structured proposal...', 'La IA transforma tu idea en una propuesta estructurada...', 'L’IA transforme votre idée en proposition structurée...'),
  c('Proposta redigida pela IA', 'AI-drafted proposal', 'Propuesta redactada por IA', 'Proposition rédigée par IA'),
  c('Editar sugestão', 'Edit suggestion', 'Editar sugerencia', 'Modifier la suggestion'),
  c('Enviar ao síndico', 'Send to board', 'Enviar al administrador', 'Envoyer au syndic'),
  c('Preferências', 'Settings', 'Preferencias', 'Préférences'),
  c('Perfil e notificações', 'Profile and notifications', 'Perfil y notificaciones', 'Profil et notifications'),
  c('Profile', 'Profile', 'Perfil', 'Profil'),
  c('Name', 'Name', 'Nombre', 'Nom'),
  c('Email', 'Email', 'Email', 'E-mail'),
  c('WhatsApp notifications', 'WhatsApp notifications', 'Notificaciones de WhatsApp', 'Notifications WhatsApp'),
  c('Ativo', 'Active', 'Activo', 'Actif'),
  c('Desativado', 'Disabled', 'Desactivado', 'Désactivé'),
  c('Salvar preferências', 'Save preferences', 'Guardar preferencias', 'Enregistrer'),

  // Board app
  c('Tudo que precisa da sua atenção.', 'Everything that needs your attention.', 'Todo lo que necesita tu atención.', 'Tout ce qui demande votre attention.'),
  c('Não foi possível carregar parte dos dados. Atualize a página ou entre novamente.', 'Some data could not load. Refresh the page or sign in again.', 'No se pudo cargar parte de los datos. Actualiza o entra de nuevo.', 'Certaines données n’ont pas pu charger. Actualisez ou reconnectez-vous.'),
  c('em votação', 'voting', 'en votación', 'en vote'),
  c('em discussão', 'discussion', 'en discusión', 'en discussion'),
  c('aprovada', 'approved', 'aprobada', 'approuvée'),
  c('reprovada', 'rejected', 'rechazada', 'rejetée'),
  c('concluída', 'completed', 'concluida', 'terminée'),
  c('inconclusiva', 'inconclusive', 'inconclusa', 'non concluante'),
  c('Resident suggestions', 'Resident suggestions', 'Sugerencias de residentes', 'Suggestions des résidents'),
  c('Raw input from residents. Cluster related items, promote to proposals, or dismiss.', 'Raw input from residents. Cluster related items, promote to proposals, or dismiss.', 'Ideas de residentes. Agrupa temas, promueve propuestas o descarta.', 'Retours des résidents. Regroupez, transformez en propositions ou ignorez.'),
  c('Cluster with AI', 'Cluster with AI', 'Agrupar con IA', 'Regrouper avec IA'),
  c('Clustered with AI', 'Clustered with AI', 'Agrupado con IA', 'Regroupé par IA'),
  c('Promoted to a proposal', 'Promoted to a proposal', 'Promovido a propuesta', 'Transformé en proposition'),
  c('Cluster', 'Cluster', 'Grupo', 'Groupe'),
  c('Unclustered', 'Unclustered', 'Sin agrupar', 'Non regroupé'),
  c('Open suggestions', 'Open suggestions', 'Sugerencias abiertas', 'Suggestions ouvertes'),
  c('Dismiss', 'Dismiss', 'Descartar', 'Ignorer'),
  c('Promote', 'Promote', 'Promover', 'Promouvoir'),
  c('All clear! Run the AI clusterer above when new suggestions come in.', 'All clear! Run the AI clusterer above when new suggestions come in.', 'Todo listo. Usa el agrupador con IA cuando lleguen sugerencias.', 'Tout est clair. Lancez le regroupement IA quand de nouvelles suggestions arrivent.'),
  c('Nova assembleia', 'New assembly', 'Nueva asamblea', 'Nouvelle assemblée'),
  c('Assembleia criada — adicione itens à pauta', 'Assembly created — add agenda items', 'Asamblea creada — agrega puntos a la agenda', 'Assemblée créée — ajoutez des points à l’ordre du jour'),
  c('Create failed', 'Create failed', 'Error al crear', 'Échec de création'),
  c('Ordinária (AGO)', 'Ordinary (AGO)', 'Ordinaria (AGO)', 'Ordinaire (AGO)'),
  c('Extraordinária (AGE)', 'Extraordinary (AGE)', 'Extraordinaria (AGE)', 'Extraordinaire (AGE)'),
  c('1ª chamada', '1st call', '1ª convocatoria', '1er appel'),
  c('2ª chamada (optional — defaults to +30min)', '2nd call (optional — defaults to +30min)', '2ª convocatoria (opcional — +30 min por defecto)', '2e appel (facultatif — +30 min par défaut)'),
  c('Nenhuma assembleia ainda. Comece a AGO quando chegar o ciclo anual.', 'No assemblies yet. Start the AGO when the annual cycle arrives.', 'Aún no hay asambleas. Inicia la AGO cuando llegue el ciclo anual.', 'Aucune assemblée pour le moment. Lancez l’AGO au cycle annuel.'),
  c('Invite code', 'Invite code', 'Código de invitación', 'Code d’invitation'),
  c('Copied', 'Copied', 'Copiado', 'Copié'),
  c('Copy', 'Copy', 'Copiar', 'Copier'),
  c('Bulk import resident roster', 'Bulk import resident roster', 'Importar residentes en lote', 'Importer les résidents en lot'),
  c('Rows that need attention', 'Rows that need attention', 'Filas que necesitan atención', 'Lignes à vérifier'),
  c('pending', 'pending', 'pendiente', 'en attente'),
  c('emailed', 'emailed', 'enviado por email', 'envoyé par e-mail'),
  c('email failed', 'email failed', 'falló el email', 'échec e-mail'),
  c('Board', 'Board', 'Consejo', 'Conseil'),
  c('Resident approved', 'Resident approved', 'Residente aprobado', 'Résident approuvé'),
  c('Request denied', 'Request denied', 'Solicitud rechazada', 'Demande refusée'),
  c('Approve', 'Approve', 'Aprobar', 'Approuver'),
  c('Deny', 'Deny', 'Rechazar', 'Refuser'),

  // Onboarding
  c('Welcome', 'Welcome', 'Bienvenido', 'Bienvenue'),
  c('Welcome,', 'Welcome,', 'Bienvenido,', 'Bienvenue,'),
  c('Step 1 of 2', 'Step 1 of 2', 'Paso 1 de 2', 'Étape 1 sur 2'),
  c('Waiting for approval', 'Waiting for approval', 'Esperando aprobación', 'En attente d’approbation'),
  c('Join a building', 'Join a building', 'Unirse a un edificio', 'Rejoindre un immeuble'),
  c('Create a new building', 'Create a new building', 'Crear un edificio nuevo', 'Créer un nouvel immeuble'),
  c('Create a building', 'Create a building', 'Crear edificio', 'Créer un immeuble'),
  c('Building', 'Building', 'Edificio', 'Immeuble'),
  c('Structure', 'Structure', 'Estructura', 'Structure'),
  c('Preferences', 'Preferences', 'Preferencias', 'Préférences'),
  c('Done', 'Done', 'Listo', 'Terminé'),
  c('What\'s your building called?', 'What\'s your building called?', '¿Cómo se llama tu edificio?', 'Comment s’appelle votre immeuble ?'),
  c('Residents will see this name when they join.', 'Residents will see this name when they join.', 'Los residentes verán este nombre al unirse.', 'Les résidents verront ce nom en rejoignant.'),
  c('Building / tower name', 'Building / tower name', 'Nombre del edificio / torre', 'Nom de l’immeuble / tour'),
  c('Structure & your unit', 'Structure & your unit', 'Estructura y tu unidad', 'Structure et votre lot'),
  c('You can rename individual units later.', 'You can rename individual units later.', 'Puedes renombrar unidades después.', 'Vous pourrez renommer les lots plus tard.'),
  c('Continue', 'Continue', 'Continuar', 'Continuer'),
  c('Back', 'Back', 'Volver', 'Retour'),
  c('Create building', 'Create building', 'Crear edificio', 'Créer l’immeuble'),
  c('You\'re in.', 'You\'re in.', 'Ya estás dentro.', 'Vous y êtes.'),
  c('Copy code', 'Copy code', 'Copiar código', 'Copier le code'),
  c('Copied!', 'Copied!', '¡Copiado!', 'Copié !'),
  c('Enter your invite code', 'Enter your invite code', 'Ingresa tu código de invitación', 'Entrez votre code d’invitation'),
  c('Building found', 'Building found', 'Edificio encontrado', 'Immeuble trouvé'),
  c('Request sent', 'Request sent', 'Solicitud enviada', 'Demande envoyée'),
  c('Request to join', 'Request to join', 'Solicitar ingreso', 'Demander à rejoindre'),
  c('Join now', 'Join now', 'Unirse ahora', 'Rejoindre maintenant'),
];

function c(pt: string, en: string, es: string, fr: string): Copy {
  return { 'pt-BR': pt, 'en-US': en, 'es-ES': es, 'fr-FR': fr };
}

const indexes: Record<AppLocale, Map<string, string>> = {
  'pt-BR': new Map(),
  'en-US': new Map(),
  'es-ES': new Map(),
  'fr-FR': new Map(),
};

for (const entry of phrases) {
  for (const target of Object.keys(indexes) as AppLocale[]) {
    for (const source of Object.values(entry)) {
      const key = normalize(source);
      if (!indexes[target].has(key)) indexes[target].set(key, entry[target]);
    }
  }
}

function translateText(value: string, locale: AppLocale): string {
  if (!/[A-Za-zÀ-ÿ]/.test(value)) return value;
  const leading = value.match(/^\s*/)?.[0] || '';
  const trailing = value.match(/\s*$/)?.[0] || '';
  const body = normalize(value);
  const exact = indexes[locale].get(body);
  if (exact) return `${leading}${exact}${trailing}`;
  return translatePatterns(value, locale);
}

function translatePatterns(value: string, locale: AppLocale): string {
  const unit = unitLabel(locale);
  const floor = word(locale, 'Floor');
  const due = word(locale, 'due');
  return value
    .replace(/\bUnit ([A-Za-z0-9-]+)/g, `${unit} $1`)
    .replace(/\bApto ([A-Za-z0-9-]+)/g, `${unit} $1`)
    .replace(/\bFloor ([0-9]+)/g, `${floor} $1`)
    .replace(/\bdue /gi, `${due} `)
    .replace(/\bYes\b/g, word(locale, 'Yes'))
    .replace(/\bNo\b/g, word(locale, 'No'))
    .replace(/\bAbstain\b/g, word(locale, 'Abstain'));
}

function word(locale: AppLocale, key: string) {
  const map: Record<string, Copy> = {
    Floor: c('Andar', 'Floor', 'Piso', 'Étage'),
    due: c('vence', 'due', 'vence', 'échéance'),
    Yes: c('Sim', 'Yes', 'Sí', 'Oui'),
    No: c('Não', 'No', 'No', 'Non'),
    Abstain: c('Abstenção', 'Abstain', 'Abstención', 'Abstention'),
  };
  return map[key]?.[locale] || key;
}

function unitLabel(locale: AppLocale) {
  return ({ 'pt-BR': 'Apto', 'en-US': 'Unit', 'es-ES': 'Unidad', 'fr-FR': 'Lot' } as const)[locale];
}

function shouldSkip(node: Node) {
  const parent = node.parentElement;
  if (!parent) return true;
  return !!parent.closest('script,style,textarea,code,pre,.font-mono,[data-i18n-skip]');
}

function translateElement(root: ParentNode, locale: AppLocale) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (shouldSkip(node)) return NodeFilter.FILTER_REJECT;
      if (!node.textContent || !/[A-Za-zÀ-ÿ]/.test(node.textContent)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  const textNodes: Text[] = [];
  while (walker.nextNode()) textNodes.push(walker.currentNode as Text);
  for (const node of textNodes) {
    const next = translateText(node.textContent || '', locale);
    if (next !== node.textContent) node.textContent = next;
  }

  const attrNames = ['placeholder', 'aria-label', 'title', 'alt'];
  for (const el of Array.from(root.querySelectorAll?.('[placeholder],[aria-label],[title],[alt]') || [])) {
    if ((el as HTMLElement).closest('[data-i18n-skip]')) continue;
    for (const attr of attrNames) {
      const value = el.getAttribute(attr);
      if (!value) continue;
      const next = translateText(value, locale);
      if (next !== value) el.setAttribute(attr, next);
    }
  }
}

type LocaleContextValue = {
  locale: AppLocale;
  setLocale: (locale: AppLocale) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'pt-BR',
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<AppLocale>(() => detectLocale());

  const value = useMemo<LocaleContextValue>(() => ({
    locale,
    setLocale(next) {
      localStorage.setItem(STORAGE_KEY, next);
      setLocaleState(next);
      window.location.reload();
    },
  }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = 'ltr';
  }, [locale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  return useContext(LocaleContext);
}

export function TranslationRuntime() {
  const { locale } = useLocale();

  useEffect(() => {
    let queued = false;
    const run = () => {
      queued = false;
      translateElement(document.body, locale);
    };
    const queue = () => {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(run);
    };

    queue();
    const observer = new MutationObserver(queue);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['placeholder', 'aria-label', 'title', 'alt'],
    });
    return () => observer.disconnect();
  }, [locale]);

  return null;
}

export function currentIntlLocale(): AppLocale {
  return detectLocale();
}

export function formatDate(value: string | number | Date) {
  return new Date(value).toLocaleDateString(currentIntlLocale());
}

export function formatDateTime(value: string | number | Date) {
  return new Date(value).toLocaleString(currentIntlLocale());
}

export function formatCurrency(value: number, currency = 'BRL') {
  return new Intl.NumberFormat(currentIntlLocale(), {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function LanguageSwitcher() {
  const { locale, setLocale } = useLocale();
  return (
    <label className="fixed bottom-4 right-4 z-[80] flex items-center gap-2 rounded-full border border-white/60 bg-cream-50/80 px-3 py-2 text-xs font-semibold text-dusk-400 shadow-clay backdrop-blur-xl">
      <span className="sr-only">Language</span>
      <span aria-hidden>{LOCALE_OPTIONS.find((o) => o.locale === locale)?.short}</span>
      <select
        className="bg-transparent text-xs outline-none"
        value={locale}
        onChange={(e) => setLocale(e.target.value as AppLocale)}
        aria-label="Language"
      >
        {LOCALE_OPTIONS.map((option) => (
          <option key={option.locale} value={option.locale}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

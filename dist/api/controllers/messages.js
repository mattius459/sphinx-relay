"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const models_1 = require("../models");
const sequelize_1 = require("sequelize");
const underscore_1 = require("underscore");
const hub_1 = require("../hub");
const socket = require("../utils/socket");
const jsonUtils = require("../utils/json");
const helpers = require("../helpers");
const res_1 = require("../utils/res");
const confirmations_1 = require("./confirmations");
const path = require("path");
const network = require("../network");
const constants = require(path.join(__dirname, '../../config/constants.json'));
const getMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const dateToReturn = req.query.date;
    if (!dateToReturn) {
        return getAllMessages(req, res);
    }
    console.log(dateToReturn);
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    // const chatId = req.query.chat_id
    let newMessagesWhere = {
        date: { [sequelize_1.Op.gte]: dateToReturn },
        [sequelize_1.Op.or]: [
            { receiver: owner.id },
            { receiver: null }
        ]
    };
    let confirmedMessagesWhere = {
        updated_at: { [sequelize_1.Op.gte]: dateToReturn },
        status: constants.statuses.received,
        sender: owner.id
    };
    // if (chatId) {
    // 	newMessagesWhere.chat_id = chatId
    // 	confirmedMessagesWhere.chat_id = chatId
    // }
    const newMessages = yield models_1.models.Message.findAll({ where: newMessagesWhere });
    const confirmedMessages = yield models_1.models.Message.findAll({ where: confirmedMessagesWhere });
    const chatIds = [];
    newMessages.forEach(m => {
        if (!chatIds.includes(m.chatId))
            chatIds.push(m.chatId);
    });
    confirmedMessages.forEach(m => {
        if (!chatIds.includes(m.chatId))
            chatIds.push(m.chatId);
    });
    let chats = chatIds.length > 0 ? yield models_1.models.Chat.findAll({ where: { deleted: false, id: chatIds } }) : [];
    const chatsById = underscore_1.indexBy(chats, 'id');
    res.json({
        success: true,
        response: {
            new_messages: newMessages.map(message => jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])),
            confirmed_messages: confirmedMessages.map(message => jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)]))
        }
    });
    res.status(200);
    res.end();
});
exports.getMessages = getMessages;
const getAllMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const limit = (req.query.limit && parseInt(req.query.limit)) || 1000;
    const offset = (req.query.offset && parseInt(req.query.offset)) || 0;
    const messages = yield models_1.models.Message.findAll({ order: [['id', 'asc']], limit, offset });
    const chatIds = messages.map(m => m.chatId);
    console.log(`=> getAllMessages, limit: ${limit}, offset: ${offset}`);
    let chats = chatIds.length > 0 ? yield models_1.models.Chat.findAll({ where: { deleted: false, id: chatIds } }) : [];
    const chatsById = underscore_1.indexBy(chats, 'id');
    res_1.success(res, {
        new_messages: messages.map(message => jsonUtils.messageToJson(message, chatsById[parseInt(message.chatId)])),
        confirmed_messages: []
    });
});
exports.getAllMessages = getAllMessages;
function deleteMessage(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        const id = req.params.id;
        yield models_1.models.Message.destroy({ where: { id } });
        res_1.success(res, { id });
    });
}
exports.deleteMessage = deleteMessage;
const sendMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // try {
    // 	schemas.message.validateSync(req.body)
    // } catch(e) {
    // 	return failure(res, e.message)
    // }
    const { contact_id, text, remote_text, chat_id, remote_text_map, amount, } = req.body;
    var date = new Date();
    date.setMilliseconds(0);
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    const chat = yield helpers.findOrCreateChat({
        chat_id,
        owner_id: owner.id,
        recipient_id: contact_id,
    });
    const remoteMessageContent = remote_text_map ? JSON.stringify(remote_text_map) : remote_text;
    const msg = {
        chatId: chat.id,
        type: constants.message_types.message,
        sender: owner.id,
        amount: amount || 0,
        date: date,
        messageContent: text,
        remoteMessageContent,
        status: constants.statuses.pending,
        createdAt: date,
        updatedAt: date,
    };
    // console.log(msg)
    const message = yield models_1.models.Message.create(msg);
    res_1.success(res, jsonUtils.messageToJson(message, chat));
    network.sendMessage({
        chat: chat,
        sender: owner,
        amount: amount || 0,
        type: constants.message_types.message,
        message: {
            id: message.id,
            content: remote_text_map || remote_text || text
        }
    });
});
exports.sendMessage = sendMessage;
const receiveMessage = (payload) => __awaiter(void 0, void 0, void 0, function* () {
    console.log('received message', { payload });
    var date = new Date();
    date.setMilliseconds(0);
    const total_spent = 1;
    const { owner, sender, chat, content, msg_id, chat_type, sender_alias } = yield helpers.parseReceiveParams(payload);
    if (!owner || !sender || !chat) {
        return console.log('=> no group chat!');
    }
    const text = content;
    const msg = {
        chatId: chat.id,
        type: constants.message_types.message,
        asciiEncodedTotal: total_spent,
        sender: sender.id,
        date: date,
        messageContent: text,
        createdAt: date,
        updatedAt: date,
        status: constants.statuses.received
    };
    if (chat_type === constants.chat_types.tribe) {
        msg.senderAlias = sender_alias;
    }
    const message = yield models_1.models.Message.create(msg);
    console.log('saved message', message.dataValues);
    socket.sendJson({
        type: 'message',
        response: jsonUtils.messageToJson(message, chat, sender)
    });
    hub_1.sendNotification(chat, msg.senderAlias || sender.alias, 'message');
    const theChat = Object.assign(Object.assign({}, chat.dataValues), { contactIds: [sender.id] });
    confirmations_1.sendConfirmation({ chat: theChat, sender: owner, msg_id });
});
exports.receiveMessage = receiveMessage;
const readMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const chat_id = req.params.chat_id;
    const owner = yield models_1.models.Contact.findOne({ where: { isOwner: true } });
    models_1.models.Message.update({ seen: true }, {
        where: {
            sender: {
                [sequelize_1.Op.ne]: owner.id
            },
            chatId: chat_id
        }
    });
    res_1.success(res, {});
});
exports.readMessages = readMessages;
const clearMessages = (req, res) => {
    models_1.models.Message.destroy({ where: {}, truncate: true });
    res_1.success(res, {});
};
exports.clearMessages = clearMessages;
//# sourceMappingURL=messages.js.map
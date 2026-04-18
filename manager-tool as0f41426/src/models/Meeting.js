// src/models/Meeting.js
import { DataTypes } from 'sequelize';
import sequelize from '../db.js';
import User from './User.js';

const Meeting = sequelize.define('Meeting', {
  type: {
    type: DataTypes.ENUM('ONE_ON_ONE', 'OTHER'),
    defaultValue: 'ONE_ON_ONE',
  },
  startAt: { type: DataTypes.DATE, allowNull: false },
  endAt: { type: DataTypes.DATE },
  notes: DataTypes.TEXT,
  focus: DataTypes.STRING,   // e.g. 'performance', 'coaching', 'wellbeing', etc.
  tone: DataTypes.STRING,    // e.g. 'supportive', 'direct', 'candid', etc.
});

User.hasMany(Meeting, { as: 'OrganizedMeetings', foreignKey: 'organizerId' });
Meeting.belongsTo(User, { as: 'Organizer', foreignKey: 'organizerId' });

User.hasMany(Meeting, { as: 'StaffMeetings', foreignKey: 'staffId' });
Meeting.belongsTo(User, { as: 'Staff', foreignKey: 'staffId' });

export default Meeting;

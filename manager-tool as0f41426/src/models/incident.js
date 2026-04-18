// src/models/incident.js
export default function IncidentModel(sequelize, DataTypes) {
  const Incident = sequelize.define(
    'Incident',
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      staffId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      submitterId: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },

      incidentDate: {
        type: DataTypes.DATEONLY,
        allowNull: false,
      },

      title: {
        type: DataTypes.STRING(200),
        allowNull: false,
        validate: {
          notEmpty: true,
          len: [1, 200],
        },
      },

      details: {
        type: DataTypes.TEXT,
        allowNull: true,
      },

      type: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'COACHING',
        validate: {
          isIn: [['POSITIVE', 'COACHING', 'FORMAL', 'INFO']],
        },
      },

      tone: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'NEEDS_IMPROVEMENT',
        validate: {
          isIn: [[
            'RECOGNITION',
            'ACHIEVEMENT',
            'ENCOURAGEMENT',
            'PROFESSIONAL_COMMENDATION',
            'NEEDS_IMPROVEMENT',
            'GUIDANCE',
            'REDIRECTION',
            'ACCOUNTABILITY_REMINDER',
            'PERFORMANCE_CONCERN',
            'POLICY_VIOLATION',
            'CONDUCT_CONCERN',
            'ESCALATED_DOCUMENTATION',
            'NEUTRAL_RECORD',
            'ATTENDANCE_NOTE',
            'OPERATIONAL_NOTE',
            'ADMINISTRATIVE_UPDATE',
          ]],
        },
      },

      impactArea: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isIn: [[
            'SAFETY',
            'QUALITY',
            'DELIVERY',
            'PEOPLE',
            'COST',
            'COMPLIANCE',
            'PROCESS',
            'OTHER',
          ]],
        },
      },

      theme: {
        type: DataTypes.STRING,
        allowNull: true,
        validate: {
          isIn: [[
            'OWNERSHIP',
            'TEAMWORK',
            'COMMUNICATION',
            'INITIATIVE',
            'ENGAGEMENT',
            'ATTENDANCE',
            'TRAINING',
            'CONDUCT',
            'PROCESS_IMPROVEMENT',
            'OTHER',
          ]],
        },
      },

      severity: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'LOW',
        validate: {
          isIn: [['LOW', 'MEDIUM', 'HIGH']],
        },
      },

      requiresFollowUp: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },

      followUpStatus: {
        type: DataTypes.STRING,
        allowNull: false,
        defaultValue: 'NO_ACTION',
        validate: {
          isIn: [['OPEN', 'IN_PROGRESS', 'CLOSED', 'NO_ACTION']],
        },
      },

      followUpDueDate: {
        type: DataTypes.DATEONLY,
        allowNull: true,
      },

      followUpOutcome: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
    },
    {
      modelName: 'Incident',
      tableName: 'Incidents',
      sequelize,
      timestamps: true,
      indexes: [
        { fields: ['staffId'] },
        { fields: ['submitterId'] },
        { fields: ['incidentDate'] },
        { fields: ['type'] },
        { fields: ['tone'] },
        { fields: ['theme'] },
        { fields: ['impactArea'] },
        { fields: ['severity'] },
        { fields: ['requiresFollowUp'] },
        { fields: ['followUpStatus'] },
      ],
      hooks: {
        beforeValidate: (incident) => {
          const upperOrNull = (value) => {
            if (value === null || value === undefined || value === '') return null;
            return String(value).trim().replace(/\s+/g, '_').toUpperCase();
          };

          const upperOrKeep = (value, fallback = '') => {
            const next = upperOrNull(value);
            return next || fallback;
          };

          incident.title = String(incident.title || '').trim();

          incident.type = upperOrKeep(incident.type, 'COACHING');
          incident.tone = upperOrKeep(incident.tone, 'NEEDS_IMPROVEMENT');
          incident.impactArea = upperOrNull(incident.impactArea);
          incident.theme = upperOrNull(incident.theme);
          incident.severity = upperOrKeep(incident.severity, 'LOW');
          incident.followUpStatus = upperOrKeep(incident.followUpStatus, 'NO_ACTION');

          if (!incident.requiresFollowUp) {
            incident.followUpStatus = 'NO_ACTION';
            incident.followUpDueDate = null;
          }

          if (incident.details !== null && incident.details !== undefined) {
            incident.details = String(incident.details).trim() || null;
          }

          if (incident.followUpOutcome !== null && incident.followUpOutcome !== undefined) {
            incident.followUpOutcome = String(incident.followUpOutcome).trim() || null;
          }
        },
      },
    }
  );

  Incident.associate = (models) => {
    Incident.belongsTo(models.User, {
      as: 'Staff',
      foreignKey: 'staffId',
    });

    Incident.belongsTo(models.User, {
      as: 'Submitter',
      foreignKey: 'submitterId',
    });
  };

  return Incident;
}
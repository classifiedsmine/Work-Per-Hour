import React from 'react';
import { X } from 'lucide-react';
import { User } from '../../types';

interface UserSwitchModalProps {
  isOpen: boolean;
  onClose: () => void;
  usersList: User[];
  currentUser: User;
  setCurrentUser: (user: User) => void;
  setImpersonatedUser: (user: User | null) => void;
}

export const UserSwitchModal: React.FC<UserSwitchModalProps> = ({
  isOpen,
  onClose,
  usersList,
  currentUser,
  setCurrentUser,
  setImpersonatedUser
}) => {
  if (!isOpen) return null;

  const handleSwitchUser = (user: User) => {
    setCurrentUser(user);
    setImpersonatedUser(user);
    localStorage.setItem('current_user', JSON.stringify(user));
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b p-4">
          <h2 className="text-lg font-semibold text-slate-900">Switch User</h2>
          <button 
            onClick={onClose} 
            className="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-2">
          {usersList.map((user) => (
            <button
              key={user.id}
              onClick={() => handleSwitchUser(user)}
              className={`flex w-full items-center justify-between rounded-md p-3 transition ${
                currentUser.id === user.id 
                  ? 'bg-indigo-50 text-indigo-700' 
                  : 'text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className="font-medium">{user.name}</span>
              {currentUser.id === user.id && (
                <span className="text-xs font-semibold uppercase tracking-wider text-indigo-600 bg-indigo-100 px-2 py-0.5 rounded-full">
                  Active
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

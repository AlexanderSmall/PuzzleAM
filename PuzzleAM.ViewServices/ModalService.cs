using System.Collections.Generic;
using System.Linq;
using PuzzleAM.View;

namespace PuzzleAM.ViewServices;

/// <summary>
/// Service responsible for managing modal view models.
/// </summary>
public class ModalService
{
    private readonly List<ModalView> _modals = [];
    private readonly object _syncRoot = new();

    public IReadOnlyList<ModalView> Modals
    {
        get
        {
            lock (_syncRoot)
            {
                return _modals.ToList();
            }
        }
    }

    public void Show(ModalView modal)
    {
        lock (_syncRoot)
        {
            if (!_modals.Contains(modal))
            {
                modal.IsVisible = true;
                _modals.Add(modal);
            }
        }
    }

    public void Hide(ModalView modal)
    {
        lock (_syncRoot)
        {
            if (_modals.Remove(modal))
            {
                modal.IsVisible = false;
            }
        }
    }
}
